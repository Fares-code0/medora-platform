# Medora Backend

The API service for the Medora healthcare platform. NestJS 10 · TypeScript strict · Node 20.

**Status: Milestone 6 of 43**, plus M7's authorization core. The transport layer, health endpoints, development stack, module layout, shared kernel, validated configuration, the database foundations, the full physical schema — and, from M6, **the complete authentication lifecycle**: registration with email verification, password sign-in with lockout, rotating refresh tokens with reuse detection, TOTP two-factor, and the password flows.

**Every route now requires an access token unless it is marked `@Public()`.** That inversion is M6's, and it is the one thing to know before adding an endpoint: a route added without thinking about authentication is protected, and a route that should be open has to say so.

**Every route also carries an authorization rule.** That is M7, and it is live: `AuthorizationGuard` runs right after `AccessTokenGuard`, and a route that names no rule is refused rather than waved through. Eighteen of the nineteen domain modules are still empty, so today that surface is health plus M6's auth routes — but the rule holds for every route M8 onward adds, and a test walks Nest's route table to say so. See [What M7 established](#what-m7-established). The build order is [`docs/BACKEND_IMPLEMENTATION_ROADMAP.md`](docs/BACKEND_IMPLEMENTATION_ROADMAP.md) and is worked strictly in sequence.

## Running it

Database ownership, migration, seed, and isolation guidance is in
[`docs/DATABASE_ARCHITECTURE.md`](docs/DATABASE_ARCHITECTURE.md). The full ERD is
[`docs/DATABASE_ERD.md`](docs/DATABASE_ERD.md).

```bash
npm --prefix backend install
cp backend/.env.example backend/.env                 # required since M3 — see below
docker compose -f backend/docker-compose.yml up -d   # postgres · redis · minio · mailhog
npm --prefix backend run db:deploy                   # apply migrations
npm --prefix backend run dev
```

MinIO runs from `pgsty/minio`, the community-maintained fork, because `minio/minio` is no longer on Docker Hub. An older checkout that still names `minio/minio` fails `up -d` with `pull access denied`, and compose then aborts every pull, mailhog's included. The files service writes into an existing bucket and never creates one, so on a fresh `minio-data` volume:

```bash
docker compose -f backend/docker-compose.yml exec minio sh -c \
  'mc alias set local http://localhost:9000 medora medora-dev-secret && mc mb --ignore-existing local/medora-files'
```

The MinIO console is at <http://localhost:9001> (`medora` / `medora-dev-secret`).

Mail lands in mailhog at <http://localhost:8025>. `SMTP_HOST` is `localhost` while the API runs on the host and `mailhog` if it runs inside the compose network — see `.env.example`. A delivery failure never fails the request, so an empty inbox after a `201` from `/auth/register` means checking the API log for `Mail delivery failed`.

Any Postgres 16 will do — the compose file is a convenience, not a requirement. Point `DATABASE_URL` at a local cluster and `db:deploy` works the same.

Since M3 the application **refuses to start** on an incomplete environment. A missing variable produces this, and exit code 1:

```
Invalid environment configuration:
  DATABASE_URL — Required
  JWT_SECRET — Required

Copy backend/.env.example to backend/.env and fill in the values above.
```

```bash
curl localhost:3000/api/v1/health
# {"data":{"status":"ok","services":{"db":"up","redis":"unconfigured", ...}}}
```

`db` reports `up` since M4. `unconfigured` means no probe is registered yet and is deliberately distinct from `down`, so an unwired dependency never looks like an outage (**ADR-016**).

## Quality gates

All four must pass, and the bar is **zero errors** — not zero new errors.

```bash
npm --prefix backend run typecheck \
  && npm --prefix backend run lint \
  && npm --prefix backend run test \
  && npm --prefix backend run build
```

## How the code is arranged

One folder per concern, and the same shape everywhere. Finding something in the twentieth module should work exactly like finding it in the first.

```
src/
├── main.ts                 # bootstrap: global prefix, CORS, shutdown hooks
├── app.module.ts           # root module; global interceptor + filter
├── common/                 # cross-cutting, imported by every module
│   ├── auth/               #   @Public, @CurrentUser, AuthenticatedUser
│   ├── errors/             #   AppException + the machine error codes
│   ├── http/               #   success envelope, exception filter
│   ├── logging/            #   correlation id, pino config, PHI redaction
│   └── validation/         #   Zod pipe → 422 fieldErrors
├── config/                 # the validated environment + runtime policy
│   ├── env.schema.ts       #   the contract; the only source of defaults
│   ├── env.ts              #   the ONLY file that reads process.env
│   └── policy.service.ts   #   security policy: DB (M24) over env
├── shared/                 # the kernel: what no single module owns
│   ├── database/           #   PrismaService, soft delete, audit columns
│   ├── audit/              #   AUDIT_DISPATCHER — every audited mutation
│   ├── outbox/             #   OUTBOX — cross-module effects
│   ├── files/              #   FILE_STORAGE — the six attachment kinds
│   ├── mail/               #   MAILER — auth emails now, M19's templates later
│   └── status/             #   defineStatusMachine — lifecycle tables
└── modules/                # one folder per domain, nineteen of them
    ├── index.ts            #   the registry app.module.ts spreads
    ├── health/             #   M1 infrastructure; not a domain module
    ├── auth/               #   the only one with code in it before M7
    └── appointments/       #   every domain module has the same shape:
        ├── appointments.module.ts
        ├── controllers/
        ├── services/
        ├── dto/
        └── repositories/
```

Conventions that hold throughout:

- **Modules are isolated.** A module imports `common/`, the `shared/` public indexes, and its own folder — nothing else. This is a lint error, not a guideline (see below).
- **Controllers are thin.** They validate, delegate, and return. Logic lives in services.
- **Names match the frontend exactly.** A field called `hasSevereAllergy` there is `hasSevereAllergy` here. The DTO mirrors in `frontend/src/features/**/model/types.ts` are the contract; renaming between layers is how drift starts.
- **Comments say why, not what.** If a line needs explaining, the comment explains the constraint or the decision behind it.
- **Every decision with a trade-off is an ADR** in [`../docs/DECISIONS.md`](../docs/DECISIONS.md), referenced from the code that implements it.

## What M1 established

| Concern | Where | Contract |
|---|---|---|
| Success envelope `{ data }` | `common/http/response.interceptor.ts` | API §0.2 |
| Error envelope + status mapping | `common/http/all-exceptions.filter.ts` | API §0.3, MG §10.4 |
| Machine error `code` on every error | `common/errors/error-codes.ts` | ADR-012 |
| Correlation id accept/generate/echo | `common/logging/correlation.ts` | API §0.1 |
| PHI-safe logging | `common/logging/redaction.ts` | MG §11.6, DB §10 |
| Zod validation → 422 `fieldErrors` | `common/validation/zod-validation.pipe.ts` | API §0.3 |
| Health + readiness | `modules/health/` | API §20 |

The route prefix is `/api/v1` and the refresh cookie will be scoped `Path=/api/v1/auth` — see **ADR-011**. These have to agree or the browser never sends the cookie and silent refresh stops working.

## What M2 established

Nineteen empty modules and the rules about how they may talk to each other. Nothing here is load-bearing yet, which is the point: these decisions get more expensive to change with every milestone that adds code. **ADR-019** records them.

| Concern | Where | Contract |
|---|---|---|
| The nineteen domain modules | `modules/*/` | RM M2.1 |
| One registry, spread into the root module | `modules/index.ts` | RM M2.1 |
| Audit dispatch (stub until M28) | `shared/audit/` | RM working rule 5, API §14 |
| Cross-module effects (stub until M30) | `shared/outbox/` | ADR-019 §4 |
| Object storage (503 until M25) | `shared/files/` | API §17 |
| Status machines | `shared/status/` | ADR-001, ADR-002, API §8/§9.11 |
| Module boundaries as lint errors | `eslint.config.mjs` | RM M2.2 |

### The boundary rules

Six zones, enforced by `import/no-restricted-paths` on every lint run:

| A file in… | may not import… | because |
|---|---|---|
| `modules/x/` | `modules/y/` | Nineteen modules importing each other is a mesh by M20. Query your own repository, or publish to `shared/outbox`. |
| `modules/*/` | `shared/**` internals | The kernels are tokens and interfaces; M25/M28/M30 replace what sits behind them. Import `shared/audit`, not `shared/audit/logging-audit.dispatcher`. |
| `modules/*/` | `config/**` internals | `config/env.ts` is the one file that can read a raw secret out of the environment. Import `config`, and use `ConfigService`. |
| `shared/` | `modules/**` | The kernel exists to break cycles between modules. One that depends on a module has put the cycle back. |
| `config/` | `modules/**`, `shared/**` | Configuration does not depend on the things it configures. |
| `common/` | `modules/**`, `shared/**`, `config/**` | Everything imports `common/`, so anything it imports is imported by everything. |

The nineteen sibling zones are generated from a list in the config, so adding a module without a boundary is not possible.

**The fixtures under `src/**/__boundary-fixtures__/` are supposed to fail lint.** `eslint .` ignores them and `test/boundaries.e2e-spec.ts` lints them on purpose, asserting each is rejected by the right zone. They exist because this rule fails silently: it skips any import it cannot resolve, so a renamed tsconfig or a dropped resolver would switch every zone off without producing a single error. Deleting the demonstration, as RM M2.2 suggests, would prove the rule worked once.

### Using the kernel

The kernel is `@Global` — inject the token, no module import needed.

```ts
constructor(@Inject(AUDIT_DISPATCHER) private readonly audit: AuditDispatcher) {}
```

The stubs do not behave alike, deliberately. Audit and outbox log and resolve; **file storage rejects with 503**, because a `put()` that resolved would hand back an id for bytes that do not exist and the failure would surface later as a broken download; and **`PATIENT_ASSIGNMENT_REPOSITORY` denies every query**, because a permissive care-scoping stub would make the scoping tests green and vacuous and would fail open if the M5.6 swap were ever missed. None is durable — M25, M28, M30 and M5 replace the providers, and no call site changes when they do.

## What M3 established

Configuration is a contract, not whatever `process.env` happens to hold. **ADR-020** records the decisions.

| Concern | Where | Contract |
|---|---|---|
| The environment contract | `config/env.schema.ts` | RM M3.1 |
| Fail-fast at boot, exit 1 | `main.ts` + `config/env.ts` | RM M3.1 |
| Production-only hardening | `productionRules` | ADR-020 §3 |
| Runtime security policy | `config/policy.service.ts` | RM M3.3, API §19.2 |
| Documented example | `.env.example` (parsed by its own test) | RM M3.2 |

`config/env.ts` is the only file in `src/` that reads `process.env`, and lint keeps modules out of it. Everything else injects:

```ts
constructor(
  private readonly config: ConfigService,
  private readonly policy: PolicyService,
) {}

const { loginAttemptLimit } = await this.policy.current();
```

`PolicyService` layers the database over the environment. The five administrator-editable fields carry the frontend's `SecurityPolicySettings` names exactly, and their env defaults are its seeded values copied rather than chosen — the security panel already tells an administrator what the policy is, and a backend defaulting differently would make that display wrong. The database layer arrives at M24; until then `EnvOnlyPolicySource` contributes nothing and the env defaults stand.

Two behaviours worth knowing before you rely on it: an invalid override is discarded **per key**, so one bad column costs one setting rather than the whole policy; and if the source throws, the environment defaults stand, because a settings-table outage must not take login down for everyone.

## Known issues

**One production advisory is unresolved.** `@nestjs/core <=11.1.17` carries [GHSA-36xv-jgw5-4q75](https://github.com/advisories/GHSA-36xv-jgw5-4q75); the only upstream fix is NestJS 11, and the roadmap fixes the stack at NestJS 10. Changing that is a stack decision requiring an ADR, so it has not been made unilaterally. The rest of the transitive advisories are pinned forward via `overrides` in `package.json`. M37.1 requires a clean audit and is where this must be settled.

```bash
npm --prefix backend audit --omit=dev   # 2 moderate, both this advisory
```

## Testing

Vitest, with SWC for decorator metadata (Nest DI reads types esbuild does not emit). Unit specs sit beside their source as `*.spec.ts`; end-to-end specs live in `test/` as `*.e2e-spec.ts` and drive a real Nest application through supertest.

`test/transport.e2e-spec.ts` is the server half of `frontend/src/api/errors.ts`. Each assertion there corresponds to an error state the frontend renders — if one changes, a UI error path breaks.

`test/module-graph.e2e-spec.ts` boots the application and resolves every module and kernel token from it. Its expectations are transcribed from RM M2.1 by hand rather than read from `modules/index.ts`, because a test that derives its expectations from the code under test passes just as happily when a module is deleted.

## What M4 established

The database foundations: extensions, the column conventions every M5 model copies, and the migration discipline. **ADR-021** and **ADR-022** record the decisions.

| Concern | Where | Contract |
|---|---|---|
| `pgcrypto` · `citext` · `pg_trgm` | `prisma/migrations/*_enable_extensions` | RM M4.1 |
| Column conventions, as executable reference | `prisma/schema/00-conventions.prisma` | RM M4.2 |
| Client lifecycle + soft-delete wrapper | `shared/database/prisma.service.ts` | RM M4.2 |
| Audit columns | `shared/database/audit-columns.ts` | RM M4.2 |
| Drift check, seed, CI Postgres | `npm run db:check`, `prisma/seed.ts`, `ci.yml` | RM M4.3 |
| Care-relationship scoping | ADR-022 | RM M4.4 |

### The naming law

**snake_case in the database, camelCase in the client.** Postgres folds unquoted identifiers to lower case, so a camelCase column has to be quoted forever in every hand-written query, migration and `psql` session. The client stays camelCase because those field names are the API contract.

It is not automatic: **every** multi-word field needs `@map`, **every** model needs `@@map`. A test fails any column that is not `^[a-z][a-z0-9_]*$`.

### Soft delete

Clinical data is never hard-deleted — ADR-007 retention is measured in years, and a `DELETE` would destroy the row the audit trail points at.

```ts
prisma.db.patient.findMany()                        // live rows only
prisma.db.patient.findMany({ where: ONLY_DELETED }) // only deleted
prisma.patient.findMany()                           // everything — the escape hatch
```

`prisma.db` is wrapped in the filter; `prisma` itself is not. Two clients rather than a per-query flag because `exactOptionalPropertyTypes` rejects the explicit `deletedAt: undefined` a flag would need. `findUnique` is unfiltered by design — its `where` accepts only unique fields.

### Database commands

| Command | Does |
|---|---|
| `npm run db:deploy` | Apply committed migrations. What CI and production run. |
| `npm run db:migrate` | Create and apply a migration from schema changes. Development only. |
| `npm run db:check` | Fail if `prisma/schema/` and `migrations/` disagree — **for what it can see**; see below. |
| `npm run db:seed` | Idempotent, non-destructive, refuses `APP_ENV=production`. With `APP_ENV=development` it also provisions the local demo accounts. [`docs/LOCAL_DEMO_ACCOUNTS.md`](docs/LOCAL_DEMO_ACCOUNTS.md) |
| `npm run demo:totp` | The demo administrator's current TOTP code. Development only. [`docs/LOCAL_DEMO_ACCOUNTS.md`](docs/LOCAL_DEMO_ACCOUNTS.md) |
| `npm run db:seed:production` | Reference data, catalogues and settings for a live database: no demo data, no account, create-only. [`docs/PRODUCTION_SETUP.md`](docs/PRODUCTION_SETUP.md) |
| `npm run admin:bootstrap -- --email <address> --confirm` | The first administrator of a deployment, by invitation; refuses once one exists. Runs from the build. [`docs/PRODUCTION_SETUP.md`](docs/PRODUCTION_SETUP.md) |
| `npm run db:reset` | Drop, re-migrate, re-seed. Destructive, and says so in its name. |

**`npm test` needs a database from M4 onward.** Every property M4 establishes is the database's behaviour, not the client's, and none of it can be verified against a mock. `test/setup-env.ts` defaults `DATABASE_URL` to `medora_test`.

### One thing to know before editing migrations

Migrations apply in **lexicographic filename order**, not creation order. A hand-written migration must be named to sort where it needs to run — the extensions migration is `20260814120000` precisely so it precedes any model whose column type or default depends on it. This was got wrong once during M4 and only showed up on a from-empty deploy.

## What M5 established

The full physical schema, built in the eleven steps of DB §14.2's dependency order — one migration per step. **ADR-023** and **ADR-024** record the decisions.

| Concern | Where | Contract |
|---|---|---|
| 80 enum types, lookups, `files` | `prisma/schema/01-enums.prisma`, `02-lookups.prisma` | RM M5.1 |
| Identity, credentials, sessions, tokens | `03-identity.prisma` | RM M5.2 |
| Doctors, admins, staff, rooms, clinic hours | `04-people.prisma` | RM M5.3 |
| Patients + 11 satellites, availability | `05-patients.prisma` | RM M5.4 |
| Lab and medication catalogues, interactions | `06-catalogues.prisma` | RM M5.5 |
| Appointments, queue, **care relationships** | `07-scheduling.prisma` | RM M5.6 |
| Medical records + children | `08-records.prisma` | RM M5.7 |
| Lab orders, results, prescriptions | `09-labs-pharmacy.prisma` | RM M5.8 |
| Messaging, notifications, AI, reports, settings | `10-communication.prisma` | RM M5.9 |
| Platform settings, API keys, **audit ledger** | `11-platform.prisma` | RM M5.10 |
| The ADR-010 in-scope tables | `12-adr010.prisma` | RM M5.11 |

### The schema is a folder, not a file

Prisma 7's multi-file form, one file per M5 step. `prisma.config.ts` points at `prisma/schema/`.

⚠ **The generator `output` path resolves relative to the schema file.** Moving from `prisma/schema.prisma` to `prisma/schema/` silently redirected the client to `prisma/src/generated/prisma`, and every model was `undefined` until the path gained a `../`. Worth knowing before adding a file at another depth.

### What the drift check does and does not see

Measured by probe during M5, not assumed. `prisma migrate diff` compares what the schema language can represent and **skips what it cannot**:

| Not seen — safe as raw SQL, held by tests instead | Seen — declare it, or it is drift |
|---|---|
| CHECK constraints | tables, columns, types |
| triggers and functions | ordinary indexes, including unique |
| **partial** indexes (`WHERE …`) | **BRIN**, GIN and other access methods |
| expression indexes | defaults — *including a generated column's expression* |
| table partitioning | |

Two consequences follow, and both are load-bearing:

1. **Raw SQL is for what Prisma cannot represent, and nothing else.** The `audit_events` BRIN index was first hand-written and `migrate dev` immediately generated a migration dropping it.
2. **Every CHECK, trigger and partial index is covered by a failing-insert test.** That is not thoroughness — `db:check` cannot see them, so the tests are the only thing holding them.

### Enum values are the API vocabulary

Every enum member carries an explicit `@map`, even where the two spellings coincide. Prisma identifiers cannot hold a hyphen, so `no-show` and `pending-approval` — which ADR-001 and ADR-002 fix verbatim — cannot be member names.

**The client speaks `NO_SHOW`; the wire speaks `no-show`.** Modules from M6 map between them at the serialization boundary. A test reads `pg_enum` directly, because a dropped `@map` is invisible from TypeScript: the code compiles and the client round-trips its own value quite happily.

### Derived values

DB §14.5-6 says compute, don't double-store. Three exceptions are stored, and all three are **maintained by the database** so they cannot drift from their inputs:

| Column | Mechanism | Why stored |
|---|---|---|
| `patient_vital_signs.bmi` | `GENERATED ALWAYS … STORED` | Unwritable by callers; recomputes on every write |
| `lab_orders.has_critical_result` | trigger on `lab_results` | The "Critical unreviewed: N" chip is a partial index scan, not a join |
| `resources.status` | trigger on quantity/reorder level | Filter parity with the admin list (DB §K5) |

`updated_at` is likewise trigger-maintained: Prisma's `@updatedAt` is applied client-side, so it is absent from any write that does not go through Prisma.

### The audit ledger is shaped differently

`audit_events` is partitioned by month, so its primary key is `(id, occurred_at)` — PostgreSQL requires the partition key in it (ADR-024). That is not an optimisation: ADR-007 R2 executes retention by dropping whole partitions, and the app role holds no DELETE grant, so it is the only way anything ever leaves the table.

A **DEFAULT partition** exists deliberately. Without one an out-of-range insert fails, and on an audit ledger a failed insert means an action that happened was never recorded.

### Seeding

Three layers, gated by environment:

| Layer | Environments | Contents |
|---|---|---|
| Reference data | all, production included | 22 permissions, 6 roles, departments, catalogues |
| Platform settings | all | the 11 slices, with ADR-007's retention and security defaults |
| Demo clinical data | development · test · staging | the 5 canonical patients, 5 doctors, 1 administrator |
| Demo sign-in credentials | development only (explicit `APP_ENV`) | a password for 11 demo accounts, one per role, and the demo administrator's TOTP secret: [`docs/LOCAL_DEMO_ACCOUNTS.md`](docs/LOCAL_DEMO_ACCOUNTS.md) |

**No password hash is seeded outside an explicit `APP_ENV=development`.** Test, staging and production databases never get one, and the e2e suite asserts this for the test database. The frontend's demo password exists for a mock auth service; a known-password account in every developer and staging database is an attack surface, and staging databases get restored into places nobody expected. M6 mints credentials through the register flow.

## What M6 established

The auth lifecycle of API §1, plus the account-surface routes the roadmap
assigns here. **ADR-025** and **ADR-026** record the decisions.

| Concern | Where | Contract |
|---|---|---|
| Registration, consent, verification email | `modules/auth/services/registration.service.ts` | RM M6.1 |
| Sign-in, lockout, sessions, access token | `modules/auth/services/login.service.ts` | RM M6.2 |
| Rotation, reuse detection, logout | `modules/auth/services/refresh.service.ts` | RM M6.3 |
| TOTP enrolment and the step-up | `modules/auth/services/two-factor.service.ts`, `step-up.service.ts` | RM M6.4 |
| Forgot · reset · change | `modules/auth/services/password-recovery.service.ts` | RM M6.5 |
| Verify email and resend | `modules/auth/services/email-verification.service.ts` | RM M6.6 |
| Outbound mail, as a kernel port | `shared/mail` | ADR-025 |

### The guard is global, and public is opt-out

```ts
@Public()          // this route needs no token
@Post('login')
```

Registered as an `APP_GUARD` from the auth module. The default is
"authentication required" for every route in the application, including
ones a later milestone adds and forgets to think about. Opting *in* per
controller fails silently in the direction that matters.

`@Public()`, `@CurrentUser()` and the `AuthenticatedUser` type live in
`common/auth/`, not in the auth module: `modules/health` needs the
marker, and zone 1 forbids it importing a sibling. The guard itself stays
in the module — only the vocabulary is shared.

### Three regimes for three kinds of secret

Getting these confused is the usual way an auth implementation goes
wrong, so they are named:

| Value | Treatment | Why |
|---|---|---|
| Passwords | **Argon2id** (`PasswordService`) | Human-chosen and therefore guessable; the cost parameter is what makes an offline dictionary attack expensive |
| Tokens — refresh, verification, reset, OTP challenge | **SHA-256** (`SecretService`) | 256 bits from the CSPRNG. No dictionary to try, and `refresh` runs the function on every boot |
| The TOTP secret and recovery codes | **AES-256-GCM** (`EnvelopeService`) | Must be *recoverable*: the server re-derives the same six digits the phone shows, so a digest is useless |

Nothing that grants access is stored in a form that can be replayed. A
database disclosure leaks digests and ciphertext.

### The two clocks on a session

The **access token** is a signed JWT, ≤15 minutes, verified without
touching the database — that is what makes an authenticated request cost
an HMAC instead of a query. The **refresh cookie** is `medora_rt`;
`httpOnly; Secure; SameSite=Strict; Path=/api/v1/auth`, 30 days with
`rememberMe` and 12 hours without.

The consequence is a bounded revocation window: logout revokes the
session, so refresh stops at once, while an access token already issued
stays valid until it expires. Fifteen minutes is the trade; M31's cache
is what would make a per-request check affordable if a later milestone
decides it is too wide.

Rotation keeps one generation (`sessions.previous_token_hash`), which is
what makes reuse detectable at all — see ADR-026. A replay revokes that
session and no other: the row *is* the family.

### Values with no upstream source

Four, each labelled where it is declared rather than left to look like a
transcription (ADR-025 §3): the lockout duration (15 min), the OTP
challenge window (5 min), the password-reset TTL (1 h, deliberately
shorter than verification's 24 h), and the OTP attempt bound (reuses
`loginAttemptLimit`). All are layered through `PolicyService`, so M24's
panel can override them without touching an enforcement point.

The resend cooldown is **not** in that list: 30 seconds is transcribed
from `RESEND_SECONDS` in the frontend's two countdown pages.

### Testing auth without Docker

Mailhog needs a daemon this environment does not have, so `test/support/smtp-sink.ts`
is a real SMTP server in-process. `SmtpMailer` cannot tell the difference,
and the assertions are about messages that crossed a socket.

Two things it taught us, both recorded because of how they hid:

- Nodemailer's quoted-printable **soft line breaks** wrap at 76
  characters — mid-link. A "stores only the hash" assertion passes
  happily on a truncated token, because a truncated token does not match
  the stored hash either. The sink decodes the body the way a client does.
- Supertest's cookie jar will not return a `Secure` cookie over plain
  HTTP, so the `Path` scoping is verified by driving `cookiejar` directly
  with the real `Set-Cookie` header. That checks what a client *returns*,
  which is ADR-011's actual failure mode — a mis-scoped cookie is set
  successfully and then never sent again.

## What M7 established

M7 is Authorization, and it sits on M5 (the domain schema) and M6 (authentication).
Its decision core was built ahead of both, per
[ADR-027](../docs/DECISIONS.md): authorization has a pure core — given a principal, a
capability and the matrix, may this proceed? — and an impure edge that needs three tables
and a Redis. The core needs no database, and its inputs already ship in the frontend.

### What works

| Where | What |
| --- | --- |
| `shared/authz/permission-catalogue.ts` | The 22 capabilities, 5 platform roles, PHI flags, lock rules, seeded bundles |
| `shared/authz/permission-matrix.ts` | `normalizeMatrix`, `setCapability`, `applyLocks`, `orphanedCapabilities`, `lockViolations` |
| `shared/authz/permission-resolver.service.ts` | Effective permissions = bundle ± per-user overrides, then locks re-applied; read-through cache and invalidation |
| `shared/authz/authz.decorators.ts` | `@Can(...)`, `@Roles(...)`, `@Public()` |
| `shared/authz/authorization.guard.ts` | The guard, **denying unmarked routes** |
| `shared/authz/patient-scope.service.ts` | The care-relationship gate; out of scope is 404, not 403 |
| `shared/phi/` | The five maskers and `maskPatientIdentity` |

### What does not

**The reveal endpoint and the §15 roles API are not built.** `POST /patients/{id}/reveal`
needs `patients` routes (M10) and a durable audit write (M28) — writing it against the M2
logging stub would produce exactly the audit gap the endpoint exists to close. The §15
endpoints wait on M8.

**The cache is still per-process.** `InMemoryPermissionCache` is correct on one instance and
wrong on several: an invalidation on one leaves the others serving a stale effective set
until the five-minute TTL expires, which is a revocation that does not take. Redis before
M31, not optional.

**It reads M6's primitives, not its own.** `@Public()` is `common/auth`'s — there is exactly
one — and the principal comes from the `AUTHENTICATED_USER` slot `AccessTokenGuard` writes,
narrowed by `principalOf()`. An earlier revision of this branch defined a second of each; see
the collisions table under Milestone 7 in the roadmap for why that is worse than it looks.

**Nothing is persisted and nothing is cached in Redis.** Three ports carry what does not
exist, each bound to a placeholder in `authz.module.ts`:

| Token | Bound to | State |
| --- | --- | --- |
| `ROLE_REPOSITORY` | `PrismaRoleRepository` | real — reads `role_permissions`, `user_permissions` |
| `PATIENT_ASSIGNMENT_REPOSITORY` | `PrismaPatientAssignmentRepository` | real — reads `patient_doctor_assignments` |
| `PERMISSION_CACHE` | `InMemoryPermissionCache` | **still a placeholder**; Redis before M31 |

`POST /patients/{id}/reveal` and the API §15 roles endpoints are **not built**: the reveal
must be atomic with a durable audit write, and writing it against the M2 logging stub would
produce exactly the audit gap the endpoint exists to close.

### Four rules worth knowing before you use it

**An unmarked route denies.** The usual default admits it, on the theory that authentication
already happened. Here the rows are medical records, so a forgotten decorator would be a
disclosure that no test fails on. Every route says which of the four states of API §0.4 it
is: `@Public()`, `@Authenticated()` (any signed-in user — use it only where the token's
subject *is* the decision, as on the `/me/…` routes), `@Roles(...)` or `@Can(...)`.

**Guard order is load-bearing.** `AuthorizationGuard` is registered in `auth.module.ts`
directly after `AccessTokenGuard`, not in the shared kernel, because Nest instantiates
global guards in module-import order — and the kernel is imported first. Registered there it
ran *before* authentication, found no principal, and refused every authenticated request 401
despite a valid token. Twenty-seven e2e cases said so.

**401 is authentication only** (ADR-013). The frontend's `ApiClient` answers a 401 by
refreshing and then logging out, so an authorization failure returning one would sign a
clinician out mid-shift. No principal is 401; every other refusal is 403, and neither names
the capability that was missing.

**Out of care scope is 404, not 403.** A 403 confirms the patient exists, so walking
`PT-1000`, `PT-1001`, … against a 403/404 split would disclose the roster without opening a
chart.

**A role with no matrix column resolves to nothing.** The `roles` table holds six codes and
the matrix has five columns; `nurse` is the difference, deliberately (ADR-017 §6 — no source
states what a nurse may do). `Principal.roleCode` is therefore a string rather than the
five-role union, and `bundleFor()` answers `[]` for a column-less role. A nurse can
authenticate and holds nothing, which is the fail-closed reading the M5 seed already took.

### The vocabulary is transcribed from the frontend, and checked

`permission-catalogue.ts` and `phi-mask.ts` are re-typed from
`frontend/src/types/auth/`, `frontend/src/features/admin/permissions.ts` and
`frontend/src/utils/phi-mask.ts`. Their specs load those sources across the tree boundary
and compare — ids, order, groups, PHI flags, locks, every seeded bundle, and every masker's
output character-for-character. **A capability that is not in the frontend union cannot
exist here**; adding one is a frontend change first.

Those imports are written as runtime-resolved dynamic imports rather than static ones. A
static import runs fine under Vitest and then fails `tsc` twice — `TS6059`, because the
frontend is outside the backend's `rootDir`, and `TS2307`, because `permissions.ts`'s
`@/types/auth` resolves against the *backend's* `@` alias.

CI's backend job also triggers on those three frontend files, since a parity test that does
not run on the change that breaks it is not a guard.
