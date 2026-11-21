# smart-healthcare-assistant-system

An AI-powered healthcare assistance platform that provides symptom analysis, health
recommendations, appointment management, medication reminders, mental health support,
and intelligent healthcare guidance.

## Repository layout

| Path                            | Contents                                                                                                                    |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| [`frontend/`](frontend)         | **Medora** — the React + TypeScript web client. Doctor and Administrator dashboards.                                        |
| [`backend/`](backend)           | **Medora API** — the NestJS service. Milestone 6 of 43: transport layer, health endpoints, module layout, shared kernel, validated config, the Postgres foundations, the full 106-table domain schema and the auth lifecycle — plus M7's authorization core, now enforcing on every route. |
| `.github/workflows/`            | CI — typecheck · lint · test · build on every branch and pull request.                                                      |

The backend service lives at `backend/` as a sibling of `frontend/`. Its design is fully
specified and its build order is a numbered checklist worked strictly in sequence.

## Frontend (Medora)

React 18 · TypeScript (strict) · Vite · Tailwind with a design-token layer ·
TanStack Query · React Router · React Hook Form + Zod · Vitest.

> **All data is mock data.** Every feature's `api/` layer resolves against in-memory
> fixtures and `localStorage`; no endpoint is live and there is no server. Seeded
> demo accounts are `doctor@medora.health` and `admin@medora.health`, password
> `Medora123!`. These are fixtures for a mock auth service — they grant access to
> nothing.

### Running it

```bash
npm --prefix frontend install
```

```bash
npm --prefix frontend run dev
```

### Quality gates

All four must pass; the gate is **zero errors** (17 `react-refresh` warnings are
pre-existing and accepted).

```bash
npm --prefix frontend run typecheck && npm --prefix frontend run lint && npm --prefix frontend run test && npm --prefix frontend run build
```

### Where to start reading

| Document                                                                                                                    | What it covers                                                                                             |
| --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| [`frontend/FRONTEND_CHECKLIST.md`](frontend/FRONTEND_CHECKLIST.md)                                                          | **Current state and every known gap**, with status codes and a prioritized order of work. Read this first. |
| [`frontend/UX_ARCHITECTURE.md`](frontend/UX_ARCHITECTURE.md)                                                                | The specification for both dashboards — the source of truth for scope.                                     |
| [`frontend/FRONTEND_ARCHITECTURE.md`](frontend/FRONTEND_ARCHITECTURE.md)                                                    | Module boundaries, routing, data layer, error handling.                                                    |
| [`frontend/DESIGN_SYSTEM.md`](frontend/DESIGN_SYSTEM.md) · [`frontend/COMPONENT_LIBRARY.md`](frontend/COMPONENT_LIBRARY.md) | Tokens, type scale, and the component catalogue.                                                           |
| `frontend/PHASE*.md`                                                                                                        | Per-phase build notes, in order.                                                                           |

## Backend (Medora API)

**Milestone 6 of 43**, plus M7's authorization core. What runs today: the transport layer
(success/error envelopes, correlation ids, PHI-safe logging, Zod validation),
`/api/v1/health` and `/ready`, the nineteen domain-module skeletons, the shared kernel they
dispatch audit, cross-module effects, mail, file storage and database access through, a
validated environment the service refuses to start without, the Postgres foundations, **the
full physical schema** — 106 domain tables, 80 native enum types, 125 CHECK constraints, the
status machines of DB §4 enforced as triggers, a monthly-partitioned audit ledger and a seed
carrying the canonical demo roster — and, from M6, **the complete auth lifecycle**:
registration, login with Argon2id, refresh rotation, 2FA, password recovery and email
verification.

**M7's authorization core is switched on.** The guard runs after M6's authentication guard,
every route carries a rule, and one that names none is refused rather than waved through.
The 22-capability vocabulary, the permission matrix and its locks, effective-permission
resolution, care scoping against the real assignments table and the PHI maskers are all live
— see [ADR-027](docs/DECISIONS.md). Three things still stand between here and a closed M7:
the permission cache is per-process rather than Redis, `POST /patients/{id}/reveal` waits on
a durable audit write, and the §15 roles API waits on M8. `backend/README.md` says exactly
what does and does not work.

Stack: Node 20 · TypeScript strict · NestJS 10 · Prisma · PostgreSQL 16 ·
Redis 7 + BullMQ · Zod · Argon2id · S3-compatible storage · Docker.

```bash
npm --prefix backend install
cp backend/.env.example backend/.env    # the service will not start without it
npm --prefix backend run db:deploy      # needs a Postgres 16 on DATABASE_URL
npm --prefix backend run dev
curl localhost:3000/api/v1/health
```

[`backend/README.md`](backend/README.md) covers how the code is arranged and what each
milestone established.

| Document                                                                          | What it covers                                                                                       |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| [`BACKEND_IMPLEMENTATION_ROADMAP.md`](backend/docs/BACKEND_IMPLEMENTATION_ROADMAP.md) | **The working checklist** — 44 numbered milestones (M0–M43), each with verify steps and an exit gate. |
| [`BACKEND_API_CONTRACT.md`](backend/docs/BACKEND_API_CONTRACT.md)                 | Every endpoint: routes, params, validation, error codes, auth requirements.                          |
| [`PROJECT_BACKEND_MASTER_GUIDE.md`](backend/docs/PROJECT_BACKEND_MASTER_GUIDE.md) | Context — stack rationale, roles and permissions, per-module analysis, security, deployment.         |
| [`REPO_AUDIT.md`](backend/docs/REPO_AUDIT.md)                                     | What the repository actually contains, and the seven findings that revised the roadmap.              |
| [`docs/DECISIONS.md`](docs/DECISIONS.md)                                         | The ADR register. Every decision with a trade-off, and every deviation from the roadmap.             |
| [`frontend/DATABASE_SCHEMA_EXTRACTION.md`](frontend/DATABASE_SCHEMA_EXTRACTION.md) | The database dictionary — ~105–110 tables, business rules, enum inventory, creation order.           |

Read the roadmap first; it is worked in order and updated in the same commit as the code.

### Status

The Doctor dashboard is largely built: overview, patients, patient profile,
appointments (list + calendar), labs, pharmacy, medical records, AI assistant,
messages, notifications, reports, and an 11-section settings centre.

The Administrator dashboard specified in `UX_ARCHITECTURE.md` §3 is now **complete**:
overview, doctors and verification, patients and access governance, appointment
oversight, communication monitoring, system logs, reports and platform settings, with
PHI governance underneath them. It lives at `/admin`; the clinic-operations centre it
used to be confused with survives at `/admin/clinic`.

Several clinical write paths on the doctor side are still missing — a doctor cannot
order a lab, mark a critical result reviewed, or author a record.
`frontend/FRONTEND_CHECKLIST.md` enumerates all of it.
