# M7 Authorization Core Implementation Plan

> **Historical implementation plan — not a task register** (labelled 2026-10-26). The work this plan describes has landed. Its checkboxes are the plan's steps as written and were never ticked, so they record nothing about what is done or open. Current status of M7: [`backend/docs/BACKEND_IMPLEMENTATION_ROADMAP.md`](../../../backend/docs/BACKEND_IMPLEMENTATION_ROADMAP.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the server a correct, tested authorization decision function — the 22-capability vocabulary, the 5 platform roles, the seeded bundles, the lock rules, effective-permission resolution with per-user overrides, the `@Roles`/`@Can` guard, care scoping, and the PHI maskers — with every input that M5 and M6 will eventually supply sitting behind a port.

**Architecture:** Two new shared kernels. `src/shared/authz/` holds the vocabulary, the matrix algebra, the resolver, the cache and repository ports, the decorators and the guard. `src/shared/phi/` holds the maskers and the masked-identity projection, deliberately with no access to the resolver. Both follow the `shared/audit` idiom exactly: a `*.types.ts` carrying the interface and a `Symbol` DI token, a placeholder implementation whose header says what it is not, a `*.module.ts` binding token to class, and an `index.ts` that exports the interface and the token but never the concrete class.

**Tech Stack:** Node 20 · TypeScript strict · NestJS 10 · Vitest · ESLint 9 flat.

**Spec of record:** [`docs/superpowers/specs/2026-08-26-m7-authorization-core-design.md`](../specs/2026-08-26-m7-authorization-core-design.md)

## Global Constraints

Every task's requirements implicitly include this section.

- **Working directory is `backend/`.** Every path below is relative to the repository root; every command runs from `backend/`.
- **`frontend/` is read-only.** This plan changes no frontend file. It reads three of them and tests against them.
- **The M7 roadmap row stays `[ ]`.** This plan does not close the milestone (spec §1.1, §7). Marking it done would tell M8 that routes are guarded when none exist. The roadmap gets a *progress note*, not a checkbox.
- **No new runtime dependency.** No Redis client, no JWT library, no Prisma model. Everything this plan adds is behind a port whose adapter arrives with M5/M6.
- **TypeScript strict** with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noUnusedLocals`, `noUnusedParameters`. No `any`, no non-null assertions. `readonly` on every domain field. The one permitted `as` per parity spec is the dynamic-import cast of spec §3.2.
- **Modules import the kernel through its index**, never its internals (ADR-019 zone 2). `src/shared/authz/index.ts` and `src/shared/phi/index.ts` must be added to `SHARED_PUBLIC_API` in `eslint.config.mjs` or every consumer is a lint error.
- **The kernel must not import a domain module** (zone 3) and must not import `config/` internals (zone 5).
- Comments explain *why*, not what. A file-header block naming the module's responsibility, then comments only where a reader would ask "why is it done this way".
- **Quality gates before every commit**, from `backend/`:
  ```bash
  npm run typecheck && npm run lint && npm run test && npm run build
  ```
- **Commit after every task.** Conventional-commit subject, `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` last.

### Baseline to preserve

At the branch point, against a live Postgres 16: **10 test files, 98 tests, all passing; typecheck clean; lint 0 errors; build green.** Test count rises as this plan adds specs; **no existing test may change or fail.** If one does, the change broke something — stop and report rather than adapting the test.

`test/database.e2e-spec.ts` (13 tests) needs `DATABASE_URL` to point at a real Postgres. Without one it fails by design (M4.3), and the other 85 still pass.

---

## File Structure

**Created**

| File | Responsibility |
| --- | --- |
| `src/shared/authz/permission-catalogue.ts` | The 22 capabilities, 5 platform roles, groups, PHI flags, lock rules, seeded bundles |
| `src/shared/authz/permission-catalogue.spec.ts` | Parity against `frontend/src/features/admin/permissions.ts` and `types/auth` |
| `src/shared/authz/permission-matrix.ts` | `normalizeMatrix`, `hasCapability`, `setCapability`, `orphanedCapabilities`, `lockOf` |
| `src/shared/authz/permission-matrix.spec.ts` | Lock precedence, repair, orphan detection |
| `src/shared/authz/authz.types.ts` | `Principal`, `PermissionOverrides`, the three ports and their `Symbol` tokens |
| `src/shared/authz/permission-resolver.service.ts` | `effectivePermissions`, `can`, cache read-through and invalidation |
| `src/shared/authz/permission-resolver.service.spec.ts` | Override algebra, lock precedence over overrides, cache behaviour |
| `src/shared/authz/seeded-role-repository.ts` | Placeholder adapter: seeded bundles, no overrides |
| `src/shared/authz/in-memory-permission-cache.ts` | Placeholder adapter: per-process TTL cache |
| `src/shared/authz/in-memory-permission-cache.spec.ts` | TTL expiry, `forget`, `forgetRole` |
| `src/shared/authz/authz.decorators.ts` | `@Can`, `@Roles`, `@Public` and their metadata keys |
| `src/shared/authz/authorization.guard.ts` | The guard of spec §4.3 |
| `src/shared/authz/authorization.guard.spec.ts` | Every row of the §4.3 table |
| `src/shared/authz/patient-scope.service.ts` | The care-relationship gate (M7.2) |
| `src/shared/authz/patient-scope.service.spec.ts` | Assignment required, 404-not-403, admin gets no scope |
| `src/shared/authz/unassigned-patient-assignments.ts` | Placeholder adapter that **denies everything** |
| `src/shared/authz/authz.module.ts` | Binds the three tokens; exports the resolver, guard and scope service |
| `src/shared/authz/index.ts` | Public API |
| `src/shared/phi/phi-mask.ts` | The five maskers + `maskPhi` + `PHI_FIELD_LABEL` |
| `src/shared/phi/phi-mask.spec.ts` | Parity against `frontend/src/utils/phi-mask.ts` + the two invariants |
| `src/shared/phi/masked-identity.ts` | `maskPatientIdentity` — the projection M7.3 and API §4.11 share |
| `src/shared/phi/masked-identity.spec.ts` | Projection shape; clear values never present |
| `src/shared/phi/index.ts` | Public API |
| `src/shared/__boundary-fixtures__/illegal-module-to-authz-internals.ts` | Proves zone 2 covers the new kernel |
| `test/authz-matrix.e2e-spec.ts` | The exit-gate table: route × role × capability against real controllers |

**Modified**

| File | Change |
| --- | --- |
| `src/shared/shared-kernel.module.ts` | Register `AuthzKernelModule` |
| `src/shared/index.ts` | Unchanged surface; comment names the two new kernels |
| `eslint.config.mjs` | `SHARED_PUBLIC_API` += `./authz/index.ts`, `./phi/index.ts` |
| `test/boundaries.e2e-spec.ts` | Assert the new fixture is rejected |
| `.github/workflows/ci.yml` | Backend job also triggers on the three frontend source-of-truth files |
| `backend/docs/BACKEND_IMPLEMENTATION_ROADMAP.md` | M7 progress note + deferred table; row stays `[ ]` |
| `docs/DECISIONS.md` | ADR-027 + open item RA-027.1 |
| `backend/README.md`, `README.md` | What M7 established, and what it did not |

---

## Task 1 — The vocabulary, proven against the frontend

- [ ] `permission-catalogue.ts`: `PERMISSIONS` (22, catalogue order), `PLATFORM_ROLES` (5), `PermissionGroup`, `CapabilityMeta` with `phi`/`lockedOn`/`lockedOff`/`lockReason`, `SEEDED_MATRIX`, `findCapability`.
- [ ] Types are derived from the const arrays (`(typeof PERMISSIONS)[number]`), never re-declared as a second union — a union typed twice drifts.
- [ ] `permission-catalogue.spec.ts` loads the frontend modules by the runtime-resolved dynamic import of spec §3.2 and asserts: identical capability id **set and order**; identical group, `phi`, `lockedOn`, `lockedOff` per capability; identical `PLATFORM_ROLES`; identical seeded bundle per role; and that the backend's `Permission` set equals the frontend `Permission` union exactly (22, no 23rd).
- [ ] Assert the three deliberate asymmetries of reconciliation §5 by name: admin holds no `ai.use`, no `records.edit`, no `prescriptions.create`; doctor holds no `logs.view`/`logs.export`.

**Requirements:** The parity spec must fail if either side changes. Prove it: temporarily add a 23rd capability locally, watch the spec fail, remove it. Do not commit the temporary edit.

**Verify:** `npm run typecheck && npm run lint && npm run test`

---

## Task 2 — Matrix algebra and lock precedence

- [ ] `permission-matrix.ts`: `lockOf`, `hasCapability`, `setCapability` (a locked cell returns the matrix unchanged), `orphanedCapabilities`, `normalizeMatrix` (unknown ids dropped, locks re-applied, catalogue order restored).
- [ ] `normalizeMatrix` accepts `unknown` and repairs anything — a stored document from an older capability set, a hand-edited one, junk. It is the server's half of §15.3's validation.
- [ ] `permission-matrix.spec.ts`: normalising the seeded matrix is a fixed point (byte-identical round trip); `setCapability` cannot move `roles.manage` off `admin` or onto `doctor`; junk input yields a valid matrix; orphan detection catches a capability no role holds.

**Requirements:** Lock precedence is the security property here, not a UI nicety (reconciliation §5 rule 2). Every lock in the catalogue gets a test that tries to violate it and fails.

**Verify:** `npm run typecheck && npm run lint && npm run test`

---

## Task 3 — Ports, resolver and cache

- [ ] `authz.types.ts`: `Principal` (`userId`, `platformRole`, `sessionId?`), `PermissionOverrides` (`granted`, `revoked`), `RoleRepository` + `ROLE_REPOSITORY`, `PermissionCache` + `PERMISSION_CACHE`, `PatientAssignmentRepository` + `PATIENT_ASSIGNMENT_REPOSITORY`.
- [ ] `permission-resolver.service.ts` implementing spec §4.1 in order: normalised matrix → overrides → **locks re-applied**. `can(principal, capability)`; `effectivePermissions(principal)`; `forget(userId)`; `forgetRole(role)`.
- [ ] Cache miss on an unavailable cache resolves from the repository and does not deny (spec §4.2). A cache *error* is logged, not thrown.
- [ ] `seeded-role-repository.ts` — header states plainly that it serves the M5.1 seed with no `user_permissions` overrides and that M5 replaces it.
- [ ] `in-memory-permission-cache.ts` — per-process, TTL below the 15-minute access-token life, `forgetRole` walks entries by role.
- [ ] Specs: a granted override adds; a revoked override removes; **an override cannot move a locked cell in either direction**; `forgetRole` drops exactly the members of that role; TTL expiry re-reads.

**Requirements:** The override-cannot-beat-a-lock test is the one that matters most in this task. Write it first.

**Verify:** `npm run typecheck && npm run lint && npm run test`

---

## Task 4 — Decorators and the guard

- [ ] `authz.decorators.ts`: `@Can(...capabilities)`, `@Roles(...roles)`, `@Public()`, with exported metadata keys.
- [ ] `authorization.guard.ts` implementing spec §4.3's table exactly, handler metadata overriding class metadata.
- [ ] **Unmarked routes deny.** No metadata at all → 403.
- [ ] 401 only for a missing principal; 403 for every authorization failure (ADR-013). Neither response names the missing capability.
- [ ] `authorization.guard.spec.ts` covers every row of the table plus: handler metadata beats class metadata, multiple `@Can` capabilities require all of them, `@Public` wins over an absent principal.

**Requirements:** The deny-by-default test must assert on a controller fixture with *no* decorator, not on a mocked reflector returning `undefined` — the point is that a real forgotten annotation is refused.

**Verify:** `npm run typecheck && npm run lint && npm run test`

---

## Task 5 — PHI maskers and the masked projection

- [ ] `src/shared/phi/phi-mask.ts`: `maskName`, `maskMrn`, `maskEmail`, `maskPhone`, `maskDateOfBirth`, `maskPhi`, `PhiFieldKind`, `PHI_FIELD_LABEL` — ported verbatim.
- [ ] `phi-mask.spec.ts`: parity against the frontend module over a shared corpus that includes the frontend header's own examples (`Ahmed Mansour` → `Ah••• M•••`, `PT-1004` → `••••1004`, `omar.farouk@example.test` → `o•••@example.test`, `+1 (555) 018-4402` → `••• ••• 4402`, `1984-03-11` → `••/••/1984`) plus the edge cases the frontend comments call out: empty string, whitespace only, a word shorter than the kept prefix, an MRN of exactly four characters, an email with no `@`, a phone with fewer than four digits, a date with no year.
- [ ] Assert the two invariants directly: **fixed mask width** (masking a 3-char and a 30-char name yields the same number of bullets) and **unknown masks identically to empty**.
- [ ] `masked-identity.ts`: `maskPatientIdentity(identity)` returning the masked projection API §4.11 lists, with a test asserting no clear value survives anywhere in the output object.

**Requirements:** `src/shared/phi/` must not import from `src/shared/authz/`. Masking is display; policy lives elsewhere (spec §2).

**Verify:** `npm run typecheck && npm run lint && npm run test`

---

## Task 6 — Care scoping

- [ ] `patient-scope.service.ts`: `canReach(principal, patientId)` and `assertCanReach(principal, patientId)`.
- [ ] Assignment is the only anchor; **out of scope throws `AppException.notFound`, never `forbidden`** (spec §5 rule 2).
- [ ] Holding `patients.view` does not create a care relationship (rule 3). The service does not consult the capability set at all.
- [ ] `unassigned-patient-assignments.ts` — **denies every query** and logs a warning naming M5.6. Header states why a permissive stub would be dangerous.
- [ ] Specs: assigned doctor reaches; unassigned doctor gets 404 and the message contains no patient data; admin with `patients.view` still gets 404 from the scope service; the placeholder adapter denies.

**Requirements:** Assert the thrown error's status is 404 and its `code` is `not_found`. A test that only asserts "it throws" would pass on a 403 and miss the whole point.

**Verify:** `npm run typecheck && npm run lint && npm run test`

---

## Task 7 — Wire the kernel and the boundaries

- [ ] `authz.module.ts` binds `ROLE_REPOSITORY`, `PERMISSION_CACHE`, `PATIENT_ASSIGNMENT_REPOSITORY` to the placeholder adapters; exports the resolver, the guard and the scope service; concrete classes are **not** exported from `index.ts`.
- [ ] Register in `shared-kernel.module.ts`.
- [ ] `eslint.config.mjs`: `SHARED_PUBLIC_API` += `./authz/index.ts`, `./phi/index.ts`.
- [ ] Add the boundary fixture importing an authz internal from a module, and assert in `test/boundaries.e2e-spec.ts` that ESLint rejects it.
- [ ] `.github/workflows/ci.yml`: backend job also triggers on `frontend/src/types/auth/`, `frontend/src/features/admin/permissions.ts`, `frontend/src/utils/phi-mask.ts` — otherwise the parity tests of Tasks 1 and 5 never run on the change that would break them.

**Requirements:** After this task a booted app must still log the same 19 modules and `/api/v1/health` must still answer with its five-key payload. `test/module-graph.e2e-spec.ts` proves it and must pass unedited.

**Verify:** `npm run typecheck && npm run lint && npm run test && npm run build`

---

## Task 8 — The exit-gate matrix test

- [ ] `test/authz-matrix.e2e-spec.ts`: a table-driven suite mounting fixture controllers through a real Nest app with the real guard — one route per decorator shape (`@Can`, `@Roles`, both, `@Public`, **unmarked**) — driven over every platform role.
- [ ] Assert the full 5 × 22 resolver matrix directly, which does not need routes to be meaningful.
- [ ] Include the two real routes that exist: `/api/v1/health` and `/ready` reachable unauthenticated.
- [ ] The table is generated from `PERMISSIONS` × `PLATFORM_ROLES`, not hand-transcribed — but expectations come from `SEEDED_MATRIX`, so a bug that broke both catalogue and expectation would still be caught by Task 1's parity spec.

**Requirements:** Per spec §8 this meets the exit gate in the form that survives M8; the roadmap row still does not get checked.

**Verify:** `npm run typecheck && npm run lint && npm run test && npm run build`

---

## Task 9 — Record what happened

- [ ] `docs/DECISIONS.md`: **ADR-027 — Authorization Core Ahead of Its Schema**, in the register's format (Status/Milestone/Date · Context · Evidence table · Decision · Consequences · Alternatives considered). Add **RA-027.1** (the two role unions, spec §3.1) to the open-items table.
- [ ] `backend/docs/BACKEND_IMPLEMENTATION_ROADMAP.md`: under Milestone 7, a progress note and the deferred table of spec §7. **Every M7.x checkbox stays `[ ]`.**
- [ ] `backend/README.md` and root `README.md`: what M7 established and, explicitly, that no route is guarded and nothing is persisted.
- [ ] Push to `claude/m7-start-heen25`.

**Requirements:** The roadmap edit must make it *harder*, not easier, for M8 to assume routes are protected.

**Verify:** Full gate, then `git push -u origin claude/m7-start-heen25`.
