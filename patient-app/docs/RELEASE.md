# Release runbook and rollback plan

**Checklist row:** W-09 (P1) · **Depends on:** W-03 (signing and provisioning)
**Status:** written against the repository as it stands. The steps that need a
credential this repository does not hold are marked **⛔ BLOCKED (W-03)** rather
than described as though they worked.

---

## 0. The one thing that makes mobile different

**A web deployment replaces itself. An installed app does not.**

The SPA can be withdrawn in minutes: the next page load is the new build. A
patient's phone keeps running whatever it has until they choose to update, and
the update goes through a store review queue measured in days. Every decision
below follows from that, and so does the order of §4 — **the levers that do not
need a store review come first, because they are the only ones that work
today.**

---

## 1. Before a release is cut

| # | Gate | Command | Must be |
|---|---|---|---|
| 1 | Typecheck | `npm --prefix patient-app run typecheck` | 0 errors |
| 2 | Lint | `npm --prefix patient-app run lint` | 0 errors, 0 warnings |
| 3 | Tests | `npm --prefix patient-app run test` | all passing, 0 skipped |
| 4 | Metro bundle | `npm --prefix patient-app run build` | succeeds |

Step 4 is not redundant with step 3. `expo export` runs the same Metro bundle a
release build does, so **a module that resolves under Jest but not under Metro
fails here rather than in a store submission** — which is why `CLAUDE.md` makes
it part of the gate.

Then, and separately from the gates:

- [ ] `PATIENT_FRONTEND_CHECKLIST.md` and `docs/TRACEABILITY.md` describe the
      build being cut. A row that says 🟨 for a screen now running against a
      live endpoint is how the next person plans the wrong work.
- [ ] `docs/STORE_PRIVACY.md` (W-02) matches what the build does — and is
      **signed off**, not DRAFT. Its §6 questions are the owner's.
- [ ] No fixture data can reach a patient: `EXPO_PUBLIC_ENABLE_MOCKS` is
      `false` in the `production` profile, and `configs/env.ts` **refuses to
      boot** a production build with mocks enabled. That refusal is the control;
      this checkbox is only a reminder that it exists.

### ⛔ BLOCKED (W-03) — what is not in this repository

Signing and provisioning are unresolved, so nothing below §3 can be executed as
written yet:

- iOS: a distribution certificate, a provisioning profile, an App Store Connect
  app record;
- Android: an upload key, a Play Console app record;
- `eas.json` has `development`, `preview` and `production` profiles, and
  `app.json` carries `extra.eas.projectId` as **an all-zero placeholder** — it
  is not a real project.

**These are credentials, not code.** They belong to whoever owns the developer
accounts, and this runbook cannot invent them.

---

## 2. Versioning

`app.json`'s `expo.version` is the version the app reports about itself, and it
is what the forced-upgrade gate compares against (`features/app-version/`).
`eas.json`'s `production` profile sets `autoIncrement: true`, so the **build
number** rises automatically while the **version** is a deliberate edit.

Raise `expo.version` on every submitted build. A build that ships with the same
version as its predecessor cannot be distinguished by the gate in §4.1, which is
the one mechanism that can stop it remotely.

---

## 3. Cutting the release

1. Branch from the latest `main`, per `CLAUDE.md`'s task-branch rule.
2. Raise `expo.version`.
3. Run the four gates in §1.
4. Open a pull request into `main`; merge after review.
5. `patient-app` → `main` when the integration branch is ready.
6. **⛔ BLOCKED (W-03):** `eas build --profile production --platform all`, then
   `eas submit`.
7. Tag the commit that was submitted, so §4.3 has something exact to roll back
   *to*.

---

## 4. When something is wrong in production

Read this section in order. **The first two levers work without a store
review; the third does not.**

### 4.1 Raise the minimum version — the emergency stop (W-06, built)

The app carries a forced-upgrade gate. The floor arrives as an
`X-Minimum-App-Version` response header on calls the client already makes —
**there is no version endpoint, and none exists to invent** — and the gate sits
above the auth stack, so a withdrawn build cannot sign anyone in.

To stop a build: **have the backend send `X-Minimum-App-Version` set above the
bad build's version.** No app update, no store review.

Four properties to know before using it:

- **It fails OPEN.** An absent, unparseable or unknown header means "let the
  patient through". A gate that fired on a malformed value would brick every
  installed copy at once — the catastrophe it exists to prevent, pointed the
  wrong way.
- **It gates everything below it, including sign-in.** That is the point: a
  build gets withdrawn for how it handles a session or clinical data, and
  letting it authenticate first is letting it do that thing.
- **Emergency is not behind it.** Verify this on the day; it is the property
  that matters most and the one a refactor could quietly break.
- **⛔ It is inert today.** The backend does not send the header — that is RM
  **M41.2**, untouched. The client half is built and tested; **the lever has no
  handle until the server grows one.** Until then §4.2 is the first real lever,
  and that is the single most important sentence in this document.

### 4.2 Withdraw the build from the stores

Removing a build from sale stops *new* installs and *does nothing* about the
copies already on phones. Use it alongside §4.1, never instead of it.

- **⛔ BLOCKED (W-03):** Play Console — halt the staged rollout; App Store
  Connect — remove from sale.

### 4.3 Ship a fix

The slowest lever, and the only one that repairs rather than stops.

1. Fix on a task branch from `patient-app`; the four gates in §1 apply
   unchanged.
2. Raise `expo.version` again — **never re-submit a version number**.
3. **⛔ BLOCKED (W-03):** build, submit, request an expedited review if the
   defect is a disclosure or a clinical-safety one.
4. Once adoption is high enough, raise the floor in §4.1 to retire the bad
   build for the stragglers.

### 4.4 What is NOT a rollback

**Reverting the store listing to a previous binary.** Neither store lets you
re-promote an older build over a newer one; the fix is always a higher version
number. Plan for forward-only.

---

## 5. Staged rollout

Google Play supports a percentage rollout; the App Store supports phased release
over seven days. Use both.

| Stage | Audience | Watch for |
|---|---|---|
| Internal | The team, on real devices | Boot, sign-in, an appointment list that loads |
| 1–5% | Real patients | Auth failures, blank clinical screens |
| 20% | | The same, with enough volume to see a pattern |
| 100% | | |

**⛔ What is missing to run this well:** there is no crash reporting (W-04) and
no analytics (W-05) in this app, so *"watch for"* above means the clinic's
support inbox and the backend's logs — not a dashboard. A staged rollout with no
telemetry is a rollout you learn about from patients, which is a reason to keep
the early stages small and slow rather than a reason to skip them.

---

## 6. Roles

| Decision | Who |
|---|---|
| Raise the minimum version (§4.1) | Whoever operates the backend — it is a header, not a deploy |
| Withdraw from the stores (§4.2) | Whoever holds the store accounts |
| Ship a fix (§4.3) | Engineering |
| Clinical or legal defect → stop now | Named in W-10, which is ⬜ |

---

## 7. What this runbook cannot yet promise

Each of these is a checklist row, not an oversight:

| Gap | Row | Consequence for a release |
|---|---|---|
| No signing or provisioning | **W-03** | Nothing can be submitted at all |
| The forced-upgrade header is not sent | W-06 / RM M41.2 | §4.1 is inert; §4.2 is the first working lever |
| No crash reporting | **W-04** | A crash in production is invisible until someone reports it |
| No analytics | W-05 | Adoption and drop-off are unmeasurable |
| No performance budget | **W-08** | "Is this build slower?" has no baseline to answer against |
| No app identity | **W-01** | Icon, splash and store assets are unset |
| No clinical/legal sign-off | **W-10** | **No build ships to a store without this** |

---

*Written from the repository. The blocked steps are blocked by credentials and
decisions, not by engineering.*
