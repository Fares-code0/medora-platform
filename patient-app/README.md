# Medora — Patient Mobile Application

React Native 0.88 (Expo SDK 58) · React 19.3 · TypeScript strict · Android and iOS, one codebase.

**Status: half the seam has swapped.** The design system, theme, navigation
shell, transport layer, service seam, screen states, accessibility floor,
security posture and the **complete Emergency experience** exist and are tested.

Several feature services now run against real routes; the rest are still
fixtures behind the one-line seam, because their endpoints do not exist.

**Which is which is written down once**, and this README is not the place:
[`docs/ARCHITECTURE.md` §4.1](docs/ARCHITECTURE.md) is the per-service split
and [`docs/TRACEABILITY.md`](docs/TRACEABILITY.md) is the per-screen register
that names the blocker on every row. A count repeated in a third document is
a count that goes stale the next time an endpoint lands — which is exactly
how the four contradictions the W-12 sweep found got there.
`src/test/docs-consistency.test.ts` fails if §4.1 drifts from
`src/features/*/service.ts`.

| Document | What it is |
|---|---|
| [`PATIENT_APP_AUDIT.md`](PATIENT_APP_AUDIT.md) | Repository audit, feature matrix (56 capabilities → endpoint → module → table), gap analysis, risks. **A dated snapshot of `main` @ `9e4e0d3`, not a living document** — read it for the reasoning, `TRACEABILITY.md` for the current state |
| [`PATIENT_FRONTEND_CHECKLIST.md`](PATIENT_FRONTEND_CHECKLIST.md) | 211 items across Phases A–W, with live status |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Stack, layering rule, the seam, offline policy, timezone contract, security posture |
| [`docs/TRACEABILITY.md`](docs/TRACEABILITY.md) | Every screen → service → endpoint → module → table, with what blocks it |
| [`docs/PUBLIC_PROJECTIONS.md`](docs/PUBLIC_PROJECTIONS.md) | Which doctor and clinic fields a patient may see — and which must never cross the wire |

---

## Getting started

```bash
cd patient-app
npm ci
cp .env.example .env      # defaults point at a local backend on :3000
npm start                 # then press a for Android, i for iOS
```

`.env.example` points at `http://localhost:3000/api/v1`, and that is the **only**
shape of cleartext URL the schema accepts. `EXPO_PUBLIC_API_BASE_URL` must be
`https:` unless `EXPO_PUBLIC_APP_ENV=development` **and** the host is on your own
machine or network (loopback, `10.0.0.0/8` — which covers the Android emulator's
`10.0.2.2` — `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`). Staging and
production are refused at boot with a message naming the variable: every request
carries the patient's access token and returns their clinical record, so a
cleartext origin publishes both to every hop on the network (checklist T-14).

`npm start` runs Expo. Emergency, the design system and every screen render
with no backend running — `EXPO_PUBLIC_ENABLE_MOCKS=true` is the default and
selects the **fixture** adapter behind the service seam for every feature,
including those whose HTTP adapters are now real. Set it to `false` to drive
the real ones against a running backend; the features that have no endpoint
will refuse by name rather than pretend.

### Scripts

| Script | What it does |
|---|---|
| `npm start` | Expo dev server |
| `npm run android` · `npm run ios` | Launch on a device or simulator |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint (mirrors `frontend/eslint.config.js` plus mobile rules) |
| `npm test` | Jest + React Native Testing Library |
| `npm run build` | `expo export` — bundles the app the way a release does |

### Quality gate

Zero errors on all four, the same bar the other two trees hold:

```bash
npm --prefix patient-app run typecheck \
  && npm --prefix patient-app run lint \
  && npm --prefix patient-app run test \
  && npm --prefix patient-app run build
```

---

## The one thing to know

The patient app is another client of the **same** Medora backend — not a second
system. No second database, no second authentication, no duplicated business
rule.

**The decision this tree used to be blocked on has been made.**

`ADR-018 §3` said *"patients are records, not authenticated users,"* and while
that stood, nothing behind the sign-in screen could be built. **ADR-030 was
accepted on 2026-09-02** and amends §3 (and only §3): a nullable, unique
`patients.user_id`, a `patient` role carrying no permission-matrix column, and
the M6 auth lifecycle unchanged. Checklist **A-01** is closed.

So `api/endpoints/auth.ts` now sends `role: 'patient'` at `POST /auth/register`,
and it is a constant in the adapter rather than a form field — a caller-supplied
role would be a way to ask for a different one. `src/test/parity.test.ts` reads
the backend's own `register.schema.ts` and fails if the two ever disagree; it
asserts the role is `patient` and that neither `doctor` nor `admin` appears.

**Three decisions are still open, and this tree does not work around any of
them:**

| Open | What it blocks here |
|---|---|
| **RA-030.1** — how an account is bound to an existing `PT-…` record | The claim flow (D-14, A-02). Auto-linking on email is already ruled out by ADR-030 §5 |
| **ADR-033** — the patient booking policy | The whole booking, cancel, reschedule and proposal set (I-03…I-10). The endpoints are the smaller half; may a patient cancel, from which statuses, up to when, is the larger one |
| **AD-5** — results-release policy | Every health record carries a server-supplied `ReleaseState`; the client renders it and decides nothing |

`docs/TRACEABILITY.md` names the blocker on every row it applies to.

---

## What is genuinely finished

**Emergency** (Phase N) is the one feature that needs no backend, and it is
complete:

- reachable **signed out** — it is a route in the AuthStack, not only behind the
  gate;
- works **offline** — every word is bundled, not fetched;
- **no API dependency** — nothing on the screen can fail;
- **two-step dial** — a tap opens a confirmation naming the number; nothing dials
  on one tap, and there is no swipe-to-call or long-press-to-call;
- **no invented number** — the app ships with none configured and says so plainly
  rather than showing a plausible one. Operator-supplied numbers arrive through
  BE-11.

21 tests cover those guarantees, including one that fails if a bare 3–4 digit
number ever appears in the bundled emergency copy.

---

## What is fixture-backed, and how to swap it

Every feature has a port, two adapters and one selection. A feature whose
endpoint does not exist passes `unavailableService` as its HTTP adapter:

```ts
// features/health/service.ts
export const healthService: HealthService = selectService({
  fixture: fixtureHealthService,
  http: unavailableService<HealthService>('BE-09 / AD-5', 'Your health records', [...]),
});
```

When BE-09 lands, write `api/endpoints/health.ts` and replace the `http` line.
Nothing else moves — screens call hooks, hooks call the service, and no screen
in this tree knows a network exists.

**That swap has already happened several times.** `features/doctors/service.ts` is
the worked example: it was `unavailableService('BE-04 / BE-11', …)` until
`GET /patient/doctors` landed, and the change was the one line the seam exists
for. Note what did *not* swap with it — `listDepartments` still refuses by name,
because `GET /patient/departments` (M23) is still unbuilt, and a service is
allowed to be live in nine methods and honest in the tenth.

The current split lives in one place, `docs/ARCHITECTURE.md` §4, and
`src/test/docs-consistency.test.ts` fails if it drifts from
`src/features/*/service.ts`.

In a production build the fixture branch is unreachable: `configs/env.ts`
**refuses to parse** an environment with `APP_ENV=production` and mocks enabled,
and a test asserts it.

Two more tests hold the other end of that promise, because "fails loudly" is a
claim about what a patient would actually see:

- `src/test/service-seam.test.ts` checks that no feature passes a **fixture** as
  its `http` adapter, and that every method of every port exists on the adapter
  that ships — a method left out of an `unavailableService` array is `undefined`
  in a release build, which is a crash where the design promised an
  `EndpointNotImplementedError` naming the blocker.
- `src/test/screen-refusal.test.tsx` makes every service method reject the way
  that adapter does and mounts all 26 screens against it. Every one survives,
  keeps a heading, and **stops** — no skeleton outlives the query it stands for.

---

## Security posture, in one paragraph

The refresh token lives in the platform keychain and nowhere else (beside it sits
only a non-identifying session guard, so a cold start can apply the lock and the
background timeout); one module
imports `expo-secure-store` and ESLint enforces that. The access token lives in a
private field on `ApiClient` and there is no storage API that could accept it.
**No PHI is written to disk** — there is no persistence layer that could take it —
and it is swept from memory on logout, on session loss and after a background
timeout. `utils/logger.ts` redacts by field name and is the only sanctioned
`console` caller. The API origin is **required** to be `https:` outside a
development build, rather than assumed to be — see Getting started, and
`docs/ARCHITECTURE.md` §7 for why that was the missing first control under a
deliberate decision not to pin certificates. A `401 invalid_credentials` is a credentials error, **not** an
expired session: the client branches on the envelope's machine `code`, which is
the defect the web client has and this one must not inherit.

---

## Working agreement

**Branch from `patient-app`, merge back into `patient-app`** — the tree's own
integration branch, established by [ADR-032](../docs/DECISIONS.md#adr-032--patient-app-is-the-fifth-integration-branch).

```text
patient-app → claude/<task> → PR → patient-app → (later) main
```

```bash
git fetch origin patient-app
git checkout -b claude/<short-task-description> origin/patient-app
# …work, then run the four gates above…
git push -u origin claude/<short-task-description>
# open a PR targeting patient-app — never main
```

Two things that are **not** ordinary patient-app work:

- Changing `backend/prisma/schema/01-enums.prisma` or
  `backend/src/modules/auth/dto/` is **backend** work. It trips this suite because
  `src/test/parity.test.ts` reads those files to prove the vocabularies and the
  password policy have not drifted — but the change belongs on `backend`.
- Work spanning this tree and another is cross-domain; decide the integration
  strategy before starting. See [`CLAUDE.md`](../CLAUDE.md).

CI path-filters on `^patient-app/`, so a commit here runs this suite and the
aggregate `CI` check includes it.
