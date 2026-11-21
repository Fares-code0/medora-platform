# M7 — Authorization Core

**Date:** 2026-08-26
**Roadmap row:** M7 · `backend/docs/BACKEND_IMPLEMENTATION_ROADMAP.md` §Milestone 7
**Spec of record:** `backend/docs/BACKEND_API_CONTRACT.md` §0.4 + §4.9 + §15,
`docs/ARCHITECTURE_RECONCILIATION.md` §5, `frontend/src/features/admin/permissions.ts`

---

## 1. The problem this spec exists to solve

M7 is next on a roadmap that is worked strictly in sequence, and **its two
predecessors are not built**. That is not a detail to work around quietly; it
decides the shape of the whole milestone, so it is settled here before any code
is written — the same way M0.6 settled the transport contract on paper before M1.

What is actually on disk at the branch point:

| M7 needs | Comes from | State |
| --- | --- | --- |
| `roles`, `permissions`, `role_permissions` tables | M5.1 | absent |
| `users`, `user_permissions` | M5.2 | absent |
| `patient_doctor_assignments` | M5.6 | absent |
| `patients` + MRN | M5.4 | absent |
| `audit_events` | M5.10 | absent — only the `shared/audit` stub dispatcher |
| An authenticated principal on the request | M6.2 | absent — no JWT, no session |
| Redis | M6/M19 | absent — no client in `package.json` |

`backend/prisma/schema.prisma` is 80 lines of M4 conventions over two migrations
(extensions, conventions reference). There are no domain models at all.

So a literal M7 cannot be finished now. But M7 is not uniformly blocked, and the
distinction is sharp enough to build on:

> **Authorization has a pure core and an impure edge.** The core is a *decision
> function* — given a principal, a required capability, and the current matrix,
> may this proceed? The edge is *where the inputs come from* — a JWT, three
> tables, a Redis cache.

The core needs no database, and its inputs already exist in this repository in
authoritative form. The frontend shipped the entire authorization vocabulary at
ADM-09 and ADM-10, and `docs/ARCHITECTURE_RECONCILIATION.md` §5 has already
transcribed it into the server rules M7 owes:

| Input | Source of truth | Lines |
| --- | --- | --- |
| The 22-capability union | `frontend/src/types/auth/index.ts` | `Permission` |
| The 5 platform roles | `frontend/src/features/admin/permissions.ts` | `PLATFORM_ROLES` |
| Seeded role bundles | same | `DEFAULT_PERMISSION_MATRIX` |
| Lock rules (`lockedOn`/`lockedOff`) | same | `CapabilityMeta` |
| Matrix repair/normalisation | same | `normalizePermissionMatrix` |
| PHI maskers | `frontend/src/utils/phi-mask.ts` | five functions |
| The five server rules | `docs/ARCHITECTURE_RECONCILIATION.md` §5 | 1–5 |

**Decision: build the core now, behind ports; leave the adapters for M5/M6.**
Recorded as ADR-027. This is not a new pattern — it is the pattern `src/shared/`
was created for. `AUDIT_DISPATCHER` has had a logging stub behind it since M2
precisely so eighteen modules could call `record()` before M28 exists, and
`unconfigured-file-storage.ts` does the same for M25. M7's core joins them.

### 1.1 What this milestone claims, and what it does not

**Claims.** After this spec's plan is executed, the server can answer "may this
principal do this?" correctly, with the same vocabulary, the same bundles, the
same lock rules, and the same masked output as the shipped frontend — proven by
tests that read the frontend's own source, not by transcription.

**Does not claim.** No endpoint is protected, because no endpoint but `/health`
and `/ready` exists. Nothing is persisted. Nothing is cached in Redis. The
`§15` roles-management API is not built, and `POST /patients/{id}/reveal` is not
built. **M7 is not closed by this work** and the roadmap row stays `[ ]`.

Overstating this would be the one genuinely damaging outcome — a checked M7 box
would tell M8 onward that routes are guarded when nothing is.

---

## 2. Where the code lives

ESLint's `import/no-restricted-paths` (ADR-019) forbids a module from importing
a sibling. Authorization is needed by all nineteen, so it cannot live in one of
them: `src/modules/auth/` is where M6's *authentication* lifecycle goes, not
where the guard every other module hangs off can go.

That leaves `src/common/` and `src/shared/`. Zone 4 makes `common/` the bottom
of the stack — it may import nothing of ours, so a guard there could not inject
a resolver. And `common/` today is pure transport (errors, http, logging,
validation), while `shared/` is where cross-module *domain* services live, up to
and including `status/status-machine.ts`.

**Two new kernels: `src/shared/authz/` and `src/shared/phi/`.** Both get an
`index.ts` public API and both are added to the ESLint `SHARED_PUBLIC_API` list,
so modules reach them the same way they reach audit and nothing reaches their
internals.

`phi/` is separate from `authz/` rather than a folder inside it, and that is a
deliberate line: **masking is display, not policy.** The frontend's own header
on `phi-mask.ts` insists on it — "a masking function that could be talked into
returning the clear value would be worse than none". Keeping the maskers in a
kernel with no access to the resolver makes that structural instead of
aspirational.

---

## 3. The authorization vocabulary

### 3.1 Two role unions, and the drift between them

The frontend has two role types, and they are not the same set:

- `Role` in `types/auth` = `'doctor' | 'admin'`. Its own comment calls it the
  "coarse role — selects the route tree and shell configuration". It is what
  `SessionUser.role` carries and what API §1.2 puts in the JWT.
- `PlatformRole` in `features/admin/permissions.ts` = `admin`, `doctor`,
  `reception`, `laboratory`, `pharmacy`. It is what the permission matrix is
  indexed by.

Three platform roles therefore have permission bundles but **no frontend shell
to log into**. That is real drift, and inventing a projection for it here would
be worse than naming it.

**Decision: the authz kernel speaks `PlatformRole` and only `PlatformRole`.**
Authorization is decided against the matrix, and the matrix is indexed by
platform role. How a session's platform role is projected onto the coarse `Role`
that `SessionUser` carries is a **session-issue** concern and belongs to M6.2.
Recorded as open item **RA-027.1** — it is not resolvable without deciding
whether reception/laboratory/pharmacy get a shell, which is a product question.

### 3.2 The catalogue is transcribed once and then proven

Two files carry the source of truth and both are re-typed on the server. The
risk that makes this worth a spec section is not typing a wrong string; it is
typing a *right* string today and the frontend changing it in six months.

So the transcription is not trusted. The parity specs **load the frontend modules
across the tree boundary** and assert equality against the backend's copies.
Neither file drags the SPA in: `phi-mask.ts` has no imports at all, and
`permissions.ts` has exactly one, `import type { Permission }`, which SWC erases
before it can be resolved.

**How the import is written matters, and the obvious spelling does not work.** A
static `import … from '../../frontend/src/…'` runs green under Vitest and then
fails `tsc` twice over — `TS6059`, the file is not under the backend's `rootDir`,
and `TS2307`, because `permissions.ts`'s `@/types/auth` specifier resolves
against the *backend's* `@` alias. Both go away when the specifier is built at
runtime and the module is loaded with `await import()`:

```ts
const FRONTEND = resolve(__dirname, '…/frontend/src');
const mod = (await import(`${FRONTEND}/utils/phi-mask.ts`)) as FrontendMaskers;
```

TypeScript does not statically resolve a non-literal dynamic import, so it never
walks into the other tree; the local `FrontendMaskers`/`FrontendMatrix`
interfaces restore the typing the single `as` costs, and satisfy
`recommendedTypeChecked`'s `no-unsafe-*` rules. Verified: typecheck clean, lint
clean, tests green.

That test fails if:

- a capability is added, removed, or renamed on either side;
- a seeded bundle changes on either side;
- a lock rule moves on either side;
- any masker's output changes by a single character.

Which is exactly what the roadmap asks for at M7.3 ("must agree
character-for-character") and what §5's rule 2 needs at M7.4.

**This requires a CI change to be worth anything.** `.github/workflows/ci.yml`
runs the backend job only when `^backend/` changes, so an edit to
`frontend/src/utils/phi-mask.ts` would not run the test that guards it. The three
source-of-truth files are added to the backend job's trigger paths.

---

## 4. The decision function

### 4.1 Effective permissions

§5 rule 1: *effective permissions = role bundle ± `user_permissions` overrides.*

Overrides are two-sided — a grant and a revocation — so an override set is not a
list but a signed one. The resolver's contract:

```
effective(principal) = (bundle(platformRole) ∪ granted) \ revoked
```

with one refinement that the frontend's `normalizePermissionMatrix` already
encodes and the server must not lose: **locked cells win over everything.** A
cell locked off for a role cannot be granted by an override, and a cell locked
on cannot be revoked by one. `roles.manage` is `lockedOn` for `admin` and
`lockedOff` for every other role; if a per-user override could move it, the
platform's ability to administer itself would be one bad row away from gone.

Order of application, and it is not commutative:

1. Start from the stored matrix, repaired by `normalizeMatrix` (locks applied).
2. Apply the user's grants and revocations.
3. **Re-apply locks.** Step 2 is not trusted to have respected them.

### 4.2 Caching, and what "invalidated on change" means

The roadmap says Redis-cached, invalidated on change. Redis is not in the
project yet, so the resolver takes a **cache port** (`PERMISSION_CACHE`) with an
in-memory adapter, and the Redis adapter is a `useClass` swap later — the same
move `AUDIT_DISPATCHER` makes at M28.

The part worth designing now is the invalidation contract, because getting it
wrong is a security bug rather than a performance one:

- The key is the **user id**, not the role. A role-keyed cache cannot express
  per-user overrides.
- Invalidation is **by user** (`forget(userId)`) and **by role**
  (`forgetRole(role)` → every principal holding it), because a matrix edit at
  §15.3 changes the effective set of every member of the edited role at once.
- A cache miss is never a denial. If the cache is unavailable, the resolver
  resolves from the repository; an authorization system that fails closed on an
  *infrastructure* fault denies clinicians access to charts during an incident.
  A missing *principal* still fails closed — that is authentication, not cache.
- §5 rule 4 says permission changes take effect **at next session issue**.
  The cache TTL therefore must not outlive an access token (15 min, API §1.2);
  the default is deliberately shorter.

### 4.3 The guard

`@Can('patients.view')` and `@Roles('admin')` are metadata decorators;
`AuthorizationGuard` reads them off the handler, then the controller class, and
applies:

| Situation | Result |
| --- | --- |
| No `@Can`/`@Roles`/`@Public` metadata at all | **403** — deny |
| `@Public()` | allow |
| Metadata present, no principal on the request | 401 `unauthorized` |
| `@Roles` present, principal's role not listed | 403 `forbidden` |
| `@Can` present, capability not in effective set | 403 `forbidden` |
| Both present | both must pass |

**An unmarked route denies.** This is the single most consequential choice in
the guard and it is the opposite of the usual default. A route that someone
forgot to annotate is, on the usual default, wide open to every authenticated
user — in a PHI system that is a disclosure waiting for a merge. Denying makes
the failure loud and local: the endpoint 403s in development the first time it
is called. `@Public()` exists so that opting out is deliberate, greppable, and
reviewable; `/health` and `/ready` will carry it.

401 versus 403 follows ADR-013 exactly: 401 is for *authentication* only,
because the frontend's `ApiClient` treats 401 as "refresh the token, then log
out". An authorization failure returning 401 would silently log the user out
instead of telling them they lack a capability.

Neither the message nor the code names the capability that was missing. A 403
body that says which permission would have worked is a description of the
platform's internals handed to whoever probes for it.

---

## 5. Care scoping (M7.2)

`PatientScopeService` answers one question: may this principal reach this
patient? Per ADR-022 this is service-layer in v1, so the service is the control,
not a convenience.

Three rules, all of which are the design rather than the implementation:

**1. Assignment is the anchor.** A doctor reaches a patient iff a row in
`patient_doctor_assignments` links them (DB §13.1, ADR-010 row 1). Never by name
(DECISIONS.md line 317: "care-scoping by name would be a security defect").

**2. Out of scope is 404, not 403.** ADR-022's consequences require it, and the
reason is that 403 confirms the patient exists. A doctor enumerating `PT-…` ids
against a 403/404 split would learn the clinic's entire patient roster without
reading a single chart. `assertCanReach()` throws `notFound`.

**3. Admins do not get patient scope by holding a capability.** `patients.view`
gets an admin the *masked* directory (API §4.1, §4.11). It does not create a
care relationship, and `PatientScopeService` does not consult the capability set
to invent one. This is §5 rule 5 — never ask "is this the admin".

The assignment lookup is a port (`PATIENT_ASSIGNMENT_REPOSITORY`). Its
placeholder adapter is the one place in this milestone where a stub could be
dangerous, so it is not a permissive stub: **`UnassignedPatientAssignments`
answers "no" to every query and logs a warning naming M5.6.** A stub that
answered "yes" would make every scoping test pass while proving nothing, and
would ship as an open door if the swap were ever forgotten.

---

## 6. PHI masking (M7.3, display half only)

The five maskers are ported verbatim and proven by the parity test of §3.2. Two
invariants from the frontend header carry over and are asserted directly, since
they are the properties that make masking worth doing:

- **Fixed mask width.** Three bullets regardless of the hidden length, so the
  mask does not leak how long the value was.
- **Unknown and empty mask identically.** A blank field is indistinguishable
  from a withheld one.

What is *not* in this milestone: `POST /patients/{id}/reveal`. It needs a
`patients` table (M5.4), a durable `audit_events` table (M5.10) and a
transaction that makes the reveal and the audit row atomic — the atomicity is
the whole point of §4.9, and a reveal that logged to `LoggingAuditDispatcher`
would be a reveal with no durable record of who unmasked whom. Building it now
against a stub would produce exactly the audit gap the endpoint exists to close.

The projection helper that masks a patient identity record *is* built, because
it is pure, and it is what M7.3's endpoint and API §4.11's masked admin
directory will both call.

---

## 7. Deferred, and why

| M7 item | Status | Blocked on |
| --- | --- | --- |
| M7.1 decision core, guards, cache contract | **built** | — |
| M7.1 Prisma-backed role/override repository | deferred | M5.1, M5.2 |
| M7.1 Redis cache adapter | deferred | Redis client (M6/M19) |
| M7.2 `PatientScopeService` + rules | **built** | — |
| M7.2 assignment repository adapter | deferred | M5.6 |
| M7.3 maskers + masked projection | **built** | — |
| M7.3 `POST /patients/{id}/reveal` | deferred | M5.4, M5.10, M6.2 |
| M7.4 matrix algebra + lock enforcement | **built** | — |
| M7.4 `§15` endpoints | deferred | M5.1, M8 |
| Exit gate: route × role × permission table | **partial** | see §8 |

---

## 8. The exit gate, honestly

M7's exit gate is "table-driven authz matrix test (route × role × permission)
green for all existing routes". Read literally it is satisfiable today: the only
routes are `/health` and `/ready`, both public.

Satisfying it that way would be a lie by technicality. So the gate is met in the
form that will still be true at M8:

1. A **table-driven test harness** — `authz-matrix.e2e-spec.ts` — that mounts
   real controllers with the real guard and drives every (route, role,
   capability) cell. It ships with the routes that exist, including fixture
   controllers exercising `@Can`, `@Roles`, both, and the unmarked-denies rule.
2. The **full 5 × 22 matrix** asserted against the resolver directly, which is
   the part that does not need routes to be meaningful.
3. The roadmap row stays open with the deferred items of §7 listed underneath
   it, so M8 inherits a visible obligation instead of a checked box.

---

## 9. Risks

| Risk | Mitigation |
| --- | --- |
| The port-and-adapter core is written against a schema that arrives at M5 looking different | The ports are shaped by DB §A5/§13.1, which M5 is already committed to by ADR-010. If M5 diverges, the adapter absorbs it — that is what the port is for |
| A permissive placeholder ships to production | The assignment stub denies, and the resolver's repository stub serves seeded bundles with no overrides. Neither can widen access beyond the seeded matrix |
| A checked M7 misleads M8 | The row stays `[ ]`; §7's table goes into the roadmap under it |
| Cross-tree test imports break the backend build | The imports are in `.spec.ts` files only, and the frontend sources involved are dependency-free. `tsc` scope is checked as part of the gate |
| Frontend drift lands without running the parity test | Backend CI trigger paths extended to the three source-of-truth files |

---

## 10. Quality gate

From `backend/`, all four, zero errors:

```bash
npm run typecheck && npm run lint && npm run test && npm run build
```

Baseline at the branch point, verified against a live Postgres 16: **10 test
files, 98 tests, all passing; typecheck clean; lint 0 errors; build green.** No
existing test may change or fail.

`test/database.e2e-spec.ts` (13 of those 98) needs a real database on
`DATABASE_URL` and fails without one — that is M4.3's design, not a regression.
Nothing this milestone adds requires a database.
