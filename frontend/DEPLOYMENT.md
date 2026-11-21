# Deploying the Medora frontend to Vercel

Scope: **the doctor/admin SPA in `frontend/` only.** Nothing here deploys or
configures the NestJS backend, Postgres, Prisma, Redis, BullMQ or the AI
services, and nothing here changes their behaviour.

## Project settings

The repository root is *not* the frontend root — `frontend/` is one of four
top-level trees. The Vercel project must therefore be created with:

| Setting          | Value                                    |
| ---------------- | ---------------------------------------- |
| Root Directory   | `frontend`                               |
| Framework Preset | Vite                                     |
| Install Command  | `npm ci`                                 |
| Build Command    | `npm run build:demo` — see *Demo posture* |
| Output Directory | `dist`                                   |
| Node.js Version  | ≥ 20 (`engines.node` in `package.json`)  |

Everything except Root Directory is pinned in `frontend/vercel.json`, which
Vercel reads from the configured root directory. Root Directory itself is a
project setting and cannot be expressed in `vercel.json`.

`npm ci` rather than Vercel's default `npm install`: the working agreement is
lockfile-only installs, and a resolution that drifts in the build is a build
that cannot be reproduced.

## SPA routing

`vercel.json` rewrites `/(.*)` → `/index.html`. Vercel applies rewrites only
after the filesystem check, so hashed bundles under `/assets/…` and the
other files in `public/` are still served as static files; only paths with no
matching file fall through to the shell.

Without this rewrite, a hard refresh or a pasted link on any nested route —
`/login`, `/doctor/overview`, `/admin/settings` — returns a Vercel 404,
because `createBrowserRouter` needs the server to hand back `index.html` for
paths that exist only in the client router.

## What this deployment is

**A self-contained demo, not a production install.** It runs entirely on the
in-browser mock backend: every `api/` layer resolves against fixtures and
`localStorage`, no request leaves the browser, and there is no server behind
it. Nothing it holds is real — no patient, no record, no credential.

That is a deliberate posture, and it is why the two settings below are safe
here and would not be anywhere else.

## Deploy from `main` only

`vercel.json` carries:

```json
"git": { "deploymentEnabled": { "**": false, "main": true } }
```

Vercel deploys **every** branch by default, so every task branch and every
pull request would otherwise publish its own preview URL. The `"**": false`
entry is what turns that off: unlisted branches default to *enabled*, so a
`{"main": true}` entry on its own would have changed nothing. Vercel's
overlap rule — a branch deploys if **any** matching pattern is `true` — is
what lets `main` win against the catch-all.

**The catch-all must be `**`, not `*`.** Vercel matches these keys with
minimatch, where `*` does not cross a `/`. Until 2026-10-23 the entry was
`"*": false`, which matched `frontend` and `patient_mobile_app` but not
`claude/frontend-completion-pass-3` — that branch matched no key at all, fell
back to the enabled default, and published four preview deployments.
Every task branch here is `claude/<name>`, so `*` blocked none of them. `**`
matches any number of path segments, slashes included.

To let a branch deploy again, add it explicitly:

```json
"git": { "deploymentEnabled": { "**": false, "main": true, "release/*": true } }
```

## Deploy only when `frontend/` changed

The branch filter above answers *which branches* may deploy. It says nothing
about *what changed*, so before this gate existed every commit that reached
`main` published a new deployment — a backend-only merge, a Prisma migration,
a patient-app fix and a docs typo each rebuilt and republished the same bytes.

`vercel.json` therefore also carries:

```json
"ignoreCommand": "bash scripts/vercel-ignore-build.sh"
```

This is Vercel's **Ignored Build Step**, and its contract is inverted from
the usual one:

| Script exit | Vercel does |
| ----------- | ----------- |
| `0`         | **skips** the build — no deployment is created |
| non-zero    | **proceeds** with the build |

`git diff --quiet` already exits `0` for "no differences" and `1` for
"differences", so it maps onto that contract without negation.

The two gates are layered, not alternatives — the branch filter is evaluated
first, and only a branch it permits ever reaches the path check:

| Commit on `main` touches        | Branch filter | Path check | Deploys |
| ------------------------------- | ------------- | ---------- | ------- |
| `frontend/`                     | pass          | pass       | yes     |
| `frontend/` + `backend/`        | pass          | pass       | yes     |
| `backend/` only                 | pass          | skip       | no      |
| `backend/prisma/`, `database/`  | pass          | skip       | no      |
| `patient-app/` only             | pass          | skip       | no      |
| `docs/`, root config only       | pass          | skip       | no      |
| anything, on a non-`main` branch| **blocked**   | not run    | no      |

### Why `frontend/` is the right boundary

Root Directory is `frontend`, so Vercel runs `ignoreCommand` from there and
the script's `.` pathspec means `frontend/` exactly. That is also the whole of
the build's input: Root Directory scopes the checkout the build sees, and
`installCommand` resolves `frontend/package-lock.json`. A commit that leaves
`frontend/` untouched cannot change the artifact this project publishes.

Note what this does **not** claim. It is not an assertion that backend or
schema changes are irrelevant to the app — it is that they cannot reach *this*
deployment, which runs entirely on the in-browser mock backend and calls no
API at all (see *What this deployment is*). If the demo posture is ever
reversed and a real `VITE_API_BASE_URL` is set, revisit this: a deployment
that talks to a real API may well want to redeploy on a contract change.

### It fails open

Every case the script cannot resolve — no git checkout, no reachable base
commit — exits non-zero and builds. Skipping a commit that did change the app
leaves a stale site deployed; building one that changed nothing costs a build
minute. Those are not symmetric, so the unresolvable cases all take the
cheaper mistake.

The base commit is `VERCEL_GIT_PREVIOUS_SHA` — the last successful deployment
for the branch, which spans a push carrying several commits — falling back to
`HEAD~1` when that SHA is absent or outside the shallow clone. `HEAD~1` is
correct for the merge commits `main` actually receives, because the first
parent of a merge is the previous `main` tip, so the diff is exactly what the
merge brought in.

### Turning it off

Delete the `ignoreCommand` line. Vercel then builds every commit the branch
filter allows, which is the previous behaviour.

## Demo posture — how sign-in works here

Two independent guards keep demo access out of a normal production build, and
both are working as designed. This deployment opts out of each **through the
hatch that guard already provides**, rather than by weakening it:

| Guard | What it does | How the demo build opts out |
| --- | --- | --- |
| `resolveEnableMocks` (`src/configs/env.ts`) | Throws at boot on `VITE_APP_ENV=production` + `VITE_ENABLE_MOCKS=true` | `VITE_APP_ENV=staging`, which the schema allows and the guard does not refuse |
| `demoAccessStubPlugin` + `demoAccessBoundaryPlugin` (`vite.config.ts`) | Replaces `src/features/auth/dev/` with inert stubs in any `mode === 'production'` build, then fails the build if demo strings survive | `vite build --mode development`, the case the guard is written to allow |

Neither guard was edited. A plain `npm run build` still strips demo access and
still fails if it leaks — so the protection is intact for any future build
that means it.

A third guard has **no** opt-out, and the demo build is the reason it exists.
The development-only Theme Playground (`src/features/theme-playground/`) is
gated on `import.meta.env.MEDORA_THEME_PLAYGROUND`, which `vite.config.ts` sets
to `true` only on the local dev server with `VITE_APP_ENV=development` — never
in any `vite build`. It is not gated on `import.meta.env.DEV`, because this
deployment makes `DEV` true. `themePlaygroundBoundaryPlugin`
(`scripts/theme-playground-boundary.ts`) runs on every build, this one
included, and fails it if any playground module or marker string reaches an
emitted chunk.

`build:demo` sets **both** `NODE_ENV=development` and `--mode development`,
and both are load-bearing:

- `--mode development` stops the stub plugin replacing the demo module.
- `NODE_ENV=development` is what makes `import.meta.env.DEV` true. Without it
  the module compiles but `LoginPage`'s `{import.meta.env.DEV ? … : null}`
  branch is eliminated as dead code, and the button never renders — verified
  by building both ways and grepping `dist/`.

**The cost, stated plainly:** `NODE_ENV=development` also gives React its
development build. Measured on this repository, the `react` chunk is **355 kB
in the demo build against 197 kB in a production one**, and React logs its
development warnings to the console. That is an acceptable trade for a
fixtures-only demo and would not be for a real deployment.

**And the part of that cost which is not about bytes:** React's development
build is also what makes `StrictMode` double-invoke effects — mount, tear
down, mount again against the same DOM node. This deployment therefore runs
that behaviour *in production*, so an effect that cannot survive its own
cleanup fails here and nowhere a production build was tested. When something works
locally under `npm run build && npm run preview` but not on the deployment,
this asymmetry is the first thing to suspect — reproduce with
`npm run build:demo` (not `npm run build`) and serve `dist/`.

If that cost ever stops being acceptable, the fix is *not* to weaken the
boundary: it is to replace `LoginPage`'s `import.meta.env.DEV` gate with an
explicit, default-off `VITE_DEMO_ACCESS` flag and key the stub plugin off the
same flag. That keeps a production React build and makes the opt-in
reviewable — the pattern `VITE_ENABLE_MOCKS` already adopted after "absent
must mean off" was learned the hard way.

## Environment variables

Unlike every other setting here, these live in **`vercel.json`'s `build.env`**
rather than the Vercel dashboard:

```json
"build": { "env": { "VITE_APP_ENV": "staging", "VITE_ENABLE_MOCKS": "true" } }
```

An earlier revision of this document said the opposite — dashboard only,
because "a `build.env` block overrides the dashboard silently, which is the
wrong failure mode for a flag that decides whether the app talks to real
patient data". That reasoning was right and no longer applies: this
deployment has no API behind it, so the flag decides nothing about real data.
What it decides is whether the demo works at all, and that belongs in the
repository where a reviewer can see it, not in a dashboard nobody reads.

| Variable | Value here | Notes |
| --- | --- | --- |
| `VITE_APP_ENV` | `staging` | `development \| staging \| production`. **Not** `production` — that combination is refused at boot |
| `VITE_ENABLE_MOCKS` | `true` | Serves the seeded in-browser backend |
| `VITE_API_BASE_URL` | *(unset)* | Defaults to `http://localhost:3000/api/v1`, never called while mocks are on |

### The demo accounts

Seven accounts are seeded in `src/features/auth/mock/users.ts`, all with the
password `Medora123!`, and the login page's demo hint lists all seven
(`demoAccounts`). Each is signed in by typing it into the form. They are
**not interchangeable** — five sign straight in, and two exist to make a
specific screen reachable.

**Sign straight in:**

| Account | Lands on |
| --- | --- |
| `doctor@medora.health` — Dr. Amelia Chen | Doctor workspace |
| `admin@medora.health` — Marcus Reed | Admin workspace |
| `reception@medora.health` — Sara Haddad | Reception workspace |
| `lab@medora.health` — Omar Saleh | Laboratory workspace |
| `pharmacy@medora.health` — Lina Farouk | Pharmacy workspace |

**Suspend their sign-in, deliberately.** Each demonstrates a screen that is
otherwise unreachable — signing straight in would defeat the point of the
fixture. The hint marks both with a note:

| Account | What it demonstrates | How to finish |
| --- | --- | --- |
| `unverified@medora.health` — Dr. Priya Nair | `emailVerified: false`, so login throws `email_unverified` and routes to `/verify-email` | Submit any token except the literal `invalid`; you land on the doctor dashboard |
| `secure@medora.health` — Dr. Julian Ford | `twoFactorEnabled: true`, so login returns an OTP challenge and routes to `/verify-otp` | Enter `123456`; you land on the doctor dashboard |

Both are also load-bearing test fixtures (`AuthProvider.test.tsx` signs in as
each), so neither is decoration that can be deleted.

Separately, the login page renders one **Continue as Demo Doctor** button
(`dev/DemoAccessPanel.tsx`). It does not use any of the seven: it signs in as
`DEMO_USER` (`dev/demo-session.ts`), "Demo Doctor",
`demo.doctor@medora.local`, and lands on the doctor workspace. There is no
equivalent admin button — use `admin@medora.health`. None of this grants
access to anything: each populates a session against fixtures, and there is
no server to authorize against.

## Turning this back into a real deployment

When an API exists, reverse all three in one change — they are a set, and
doing one without the others produces a deployment that either cannot log in
or silently serves fixtures:

1. `buildCommand` back to `npm run build`
2. Remove the `build.env` block; set `VITE_APP_ENV=production`,
   `VITE_ENABLE_MOCKS=false` and a real `VITE_API_BASE_URL` in the dashboard
3. Satisfy the backend CORS and cookie requirements below

Only `VITE_`-prefixed variables reach the browser, and everything prefixed
`VITE_` is embedded in the bundle in clear text. Never put a JWT secret,
database URL, service credential or private API key behind a `VITE_` name.

## Backend requirements (backend-side work, not done here)

The frontend is served from a Vercel origin; the API is served from its own.
`ApiClient` sends every request with `credentials: 'include'` so the httpOnly
refresh cookie travels with it. That is a cross-origin credentialed request,
so once `VITE_ENABLE_MOCKS=false` the **backend deployment** must:

1. Set `Access-Control-Allow-Origin` to the exact Vercel origin — not `*`,
   which browsers reject alongside credentials — and
   `Access-Control-Allow-Credentials: true`.
2. Allow the request headers the client sends: `Authorization`,
   `Content-Type`, `X-Correlation-Id`, plus `Accept`.
3. Issue the refresh cookie with `SameSite=None; Secure`, still scoped
   `Path=/api/v1/auth`. A cross-site cookie without `SameSite=None` is
   dropped by the browser, and silent refresh stops working.
4. Be served over HTTPS. A page on `https://` cannot call an `http://` API.

None of this is a frontend change and none of it was made here.

## Notes for whoever hardens this next

- `vite.config.ts` sets `sourcemap: true`, so `.map` files ship to the CDN and
  the full frontend source is readable by anyone who opens devtools. That is
  the existing project convention and was left alone; disabling it is a
  one-line change to `build.sourcemap` if the exposure is unwanted.
- `vercel.json` sends `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, `Permissions-Policy` and a `frame-ancestors 'none'` CSP —
  the subset of FRONTEND_ARCHITECTURE.md §7 item 7 that is safe to apply
  without knowing the API origin.
- A full `script-src` CSP is deliberately **not** set. The no-flash theme boot
  script in `index.html` is inline, so a strict policy needs its hash (or a
  nonce, which static hosting cannot generate per request), and `connect-src`
  needs the deployed API origin. Both are unknowable until the backend has a
  URL.
