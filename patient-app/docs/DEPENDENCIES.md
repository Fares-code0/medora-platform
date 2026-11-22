# Dependencies and supply chain

**Checklist row:** T-12 (P1) · **Also:** B-01, W-08
**Status:** **partial.** Installs are lockfile-only and the SDK now governs every
native module's version — both mechanically enforced. The audit is **not clean**,
and §4 says exactly what is in it and which single advisory reaches a patient's
phone.

---

## 0. Why this document exists

T-12 read _"Dependency audit clean; lockfile-only installs"_ with `package-lock.json`
as its whole evidence, and it was marked ✅. Half of it was true. Running the
audit for the first time returned **31 advisories, one of them critical**, and
none of that had been written down — so the row was asserting something nobody
had measured.

The useful answer is not a number. It is **which of those advisories can reach a
patient**, because an arbitrary-file-write in `tar` on the machine that runs
`expo export` is a different problem from a parser hang in code that ships inside
the app. §4 makes that split, and it is the part worth re-deriving when the
numbers change.

---

## 1. The rules

| Rule                                                                 | Where it is enforced                                   |
| -------------------------------------------------------------------- | ------------------------------------------------------ |
| **Lockfile-only installs.** CI runs `npm ci`, never `npm install`    | `.github/workflows/ci.yml`                             |
| **The Expo SDK decides the version of every module it ships**        | `src/test/sdk-versions.test.ts`                        |
| **A new runtime dependency names the capability that needs it**      | `docs/ARCHITECTURE.md` §1, and a line in the checklist |
| **No analytics, crash-reporting, advertising or permission library** | `src/test/store-privacy.test.ts`                       |
| **One substantial library cannot arrive unnoticed**                  | `src/test/bundle-budget.test.ts`                       |

The second one is new and is the one that had already failed. `package.json`
declared `expo-asset@^57.0.16` and `expo-font@^57.0.3` on **SDK 52**, whose own
`expo` package depends on `~11.0.5` and `~13.0.4`. Both were installed at the
root, so `@expo/vector-icons` — which asks `expo-font` about its glyph font in
every icon this app draws — resolved the SDK-57 copy while `expo` used its own
nested SDK-52 one. Two copies of two native modules, five majors apart, and
autolinking would have compiled the wrong one into the binary.

Nothing in the gate could see it: no types cross, so `tsc` is silent; `eslint`
does not read `node_modules`; and jest resolves whatever is on disk. `expo
doctor` does catch it and needs the Expo API, which this environment's network
policy does not reach. `bundledNativeModules.json` ships _inside_ the installed
`expo` package — it is the SDK's own statement of what it was built against, it
is already on disk, and it cannot drift from the SDK it describes. That is what
the test reads.

## 2. The runtime dependencies, and what each is for

Seventeen. Every one is reachable from `index.ts`, or is a navigator's declared
peer.

| Package                                                     | Capability                                              |
| ----------------------------------------------------------- | ------------------------------------------------------- |
| `expo` · `react` · `react-native`                           | The platform                                            |
| `expo-status-bar`                                           | The status bar's contrast follows the theme             |
| `expo-secure-store`                                         | The refresh token, and nothing else (T-02)              |
| `expo-local-authentication`                                 | The opt-in app unlock (D-15)                            |
| `expo-font` · `expo-asset`                                  | `@expo/vector-icons` loads its glyph font through them  |
| `@react-navigation/native` · `native-stack` · `bottom-tabs` | The navigator (A-03)                                    |
| `react-native-screens` · `react-native-safe-area-context`   | Declared peers of both navigators                       |
| `@tanstack/react-query`                                     | Server state (A-03)                                     |
| `react-hook-form` · `@hookform/resolvers` · `zod`           | Forms and the schemas that mirror the backend DTOs      |
| `@react-native-async-storage/async-storage`                 | Theme, locale, onboarding flag (E-02, P-07)             |
| `@react-native-community/netinfo`                           | The offline banner, and the cache's online state (R-04) |

### Removed on 2026-09-12

Found by asking, for each runtime dependency, which source file imports it.

| Removed                        | Why                                                                                                                                                                                                                                                  |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `zustand`                      | **Never imported.** A second state library, in a tree whose architecture document names TanStack Query for server state and React context for the rest. It was not in `ARCHITECTURE.md` §1's table either, so nothing had ever claimed it was wanted |
| `expo-linking`                 | **Never imported.** Deep links are `NavigationContainer`'s `linking` prop over React Native's own `Linking`; `navigation/linking.ts` uses neither this package nor anything from it                                                                  |
| `react-native-gesture-handler` | **Never imported**, and not a peer of either navigator (React Navigation 7 asks for `react-native-screens` and `react-native-safe-area-context`, not this). A native module compiled into the binary for nothing                                     |

Both of the last two are native modules, so removing them takes code out of the
app rather than only out of `node_modules`. The bundle fell **19,256 bytes**
(3,047,756 → 3,028,500; the locale and timezone work since took it to 3,034,162) across the removals and the `expo-font`/`expo-asset`
correction together.

If a later row needs one of them back — a gesture-driven sheet, say — it comes
back through the rule above: a line naming the capability.

## 3. What the app does NOT install, deliberately

`docs/ARCHITECTURE.md` §1 holds that list with the reasoning (MMKV,
`expo-screen-capture`, `expo-notifications`, `i18next`, `expo-location`), and
`store-privacy.test.ts` §1 enforces the permission-raising half of it.

One consequence is worth stating here because it looks like a gap and is not:
**checklist I-13 ("add to device calendar") cannot be built today.** Its only
sane implementation is `expo-calendar`, which is on that test's forbidden list —
the app raises exactly one runtime permission prompt, and which prompts it may
raise is a store-privacy answer awaiting the owner (W-02 §6). The row is not
blocked on a backend; it is blocked on that decision.

## 4. The audit, measured

Run `npm audit` in `patient-app/`. Re-measured **2026-11-01**, on the tree the
Expo SDK 57 upgrade left behind (`expo@~57.0.30`, `react-native@0.86.3`).
**The tree has moved since:** `package.json` now pins `expo@~58.0.23`,
`react-native@0.88.1` and `react@19.3.0` (SDK 58), and the counts below were
**not** re-measured on it — they describe SDK 57, and the SDK-upgrade row in §5
has fired again:

| Severity  | 2026-09-12 | 2026-11-01 |
| --------- | ---------- | ---------- |
| Critical  | 1          | **0**      |
| High      | 11         | 3          |
| Moderate  | 19         | 44         |
| Low       | 0          | 6          |
| **Total** | **31**     | **53**     |

**The total rose and the picture improved.** Both are true and they are not in
tension. The SDK upgrade §4.2 was waiting on **landed** (PR #65), which replaced
the whole build-tooling tree: the critical is gone, and so is the one advisory
that used to ship inside the app (§4.1). The larger total is a bigger tooling
tree measured against an advisory database that has itself grown in seven weeks.
**A count is not the finding** — §0 says so, and this is the case it was written
for. The finding is which advisories reach a phone, and there is now exactly one.

### 4.1 What reaches a patient's phone: one advisory, and it is no longer a deep link

Measured rather than read off the tree: of the 53, exactly **four** are attached
to a package in `package.json`'s `dependencies`, and three of those four carry
**no advisory of their own** — they are flagged only because build tooling sits
somewhere beneath them.

| Runtime package      | Severity | Own advisories | Flagged via                                         |
| -------------------- | -------- | -------------- | --------------------------------------------------- |
| `expo`               | moderate | **0**          | `@expo/cli`, `@expo/config`, `@expo/config-plugins` |
| `expo-splash-screen` | moderate | **0**          | `@expo/config-plugins`                              |
| `react-native`       | moderate | **0**          | `@react-native/jest-preset`, `virtualized-lists`    |
| `zod`                | **high** | **1**          | — (its own code)                                    |

So **`zod` is the only advisory in code this app imports.** It is a direct
dependency and ten source modules import it: `schemas/envelope.ts`, the seven
`api/endpoints/*.ts` parsers, `features/auth/schemas.ts` and `configs/env.ts`.

`zod@3.25.76` · **high** (CVSS 7.5, `AV:N/AC:L/PR:N/UI:N/C:N/I:N/A:H`) ·
[GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) ·
_memory exhaustion while validating a large collection_ · **fix: `zod@4.6.6`,
a semver-major upgrade.**

**What the defect is.** zod reports one issue per failing element and caps
nothing, so validating a large, mostly-invalid array allocates one issue object
per element. Verified in this tree rather than assumed, because the advisory
describes zod 4's `$ZodArray` while npm's range (`<4.6.6`) sweeps in 3.x: a
200,000-element bad array against `z.array(z.object({ id: z.string() }))` on the
installed `zod@3.25.76` returns **200,000 issues** and ~79 MB of heap. The shape
is present in 3.x.

**A length constraint does not bound it.** `z.array(item).max(50)` was measured
on the same input: **200,001 issues** — the `max` check is added as one more
issue and every element is still validated. So `.max()` is not a mitigation
here, and the advisory's "constrained collections" wording is misleading.

**Where untrusted input reaches it.** zod parses **server responses**, through
`parseResponse` in `schemas/envelope.ts`, and `paginatedSchema`'s `items:
z.array(item)` is deliberately unconstrained. The input is therefore the Medora
API over TLS, not an arbitrary attacker: no form in this app validates a
user-supplied array. The realistic trigger is **the server's own fault** — a
paginated route that ignores its `limit`, or a schema drift that makes every row
invalid — and the consequence is the app exhausting memory instead of showing
an error state. The impact is availability only (`C:N/I:N`): no disclosure, and
no PHI at risk.

#### What this app fixed, and what only the upgrade fixes

`parseResponse` was amplifying the defect with its own code. It mapped **every**
issue to a path string, then both retained that list on the thrown
`ResponseContractError` and handed it to `logger.error` to serialise —
measured at ~6 MB of path strings for 100,000 bad rows, a second copy of the
payload in memory and in the log.

That half is closed (2026-11-01). The reported list is bounded to **20 paths**
and the true total travels beside it as `issueCount`, so a malformed collection
can no longer cost this module a copy of itself. Diagnosis needs the first few
paths, not every index. `src/schemas/envelope.test.ts` pins it: three of its five
tests fail on the unbounded version, and one of them holds the existing privacy
guarantee — paths only, never a value from the payload (T-04).

**This is not a fix for the advisory.** zod still allocates its own issue
objects before `safeParse` returns, and only `zod@4` removes that. What is
closed is this app's multiplication of it — the same relationship
`navigation/link-guard.ts` had to the advisory below, and recorded the same way:
the path this app opens is shut, the dependency is still carried.

⛔ **BLOCKED — owner decision: `zod@3` → `zod@4`.** A semver-major upgrade of
the library that parses every server response, so it is a contract-risk change
across all ten modules above, not a dependency bump. Recorded here rather than
attempted. **Who resolves it:** the project owner, then whoever owns
`api/endpoints/`.

#### Resolved: the deep-link chain that used to be the one that shipped

Until the SDK upgrade this section named a different advisory —
`decode-uri-component` ← `query-string` ← `@react-navigation/core`, moderate,
_denial of service via exponential decoding of malformed percent-encoded input_,
with **no fix at any version**. The reachable input was a deep link: React
Navigation parsed a URL's query string before any of this app's code saw it, so
a crafted `medora://…` URL could hang the JS thread.

**It is gone.** `npm ls decode-uri-component` and `npm ls query-string` both
return empty on this tree — the upgrade's React Navigation no longer depends on
either. The advisory that §4.1 was written about is no longer in the app.

`navigation/link-guard.ts` **stays**, and is now defence in depth rather than a
guard over a live advisory. `linking.ts` still overrides `getStateFromPath` and
still refuses a path that exceeds **512 characters** (no declared route is
close; the longest is `appointments/:appointmentId`) or contains a `%` that is
not the start of a well-formed `%XX` escape — the shape `encodeURIComponent`
cannot emit. A refused link resolves to **nothing**, which is what an unmatched
path already did; it refuses rather than repairs, because repairing a malformed
escape means guessing what a hostile author meant and a wrong guess could route
a patient to a screen showing a chart. `navigation/link-guard.test.ts` keeps
asserting both halves — the predicate, and that `linking.ts` calls it.

Removing the guard is not proposed: it costs nothing, it is tested, and it bounds
the next parser React Navigation acquires.

### 4.2 Everything else: the build machine, not the app

The remaining **49** advisories are in tooling that runs on the machine building
the app and never ships inside it. The three `high` ones are
`@expo/cli`, `node-forge` (reached only through `@expo/cli` →
`@expo/code-signing-certificates`) and `zod` — and that last one is counted
here only because `@expo/cli` depends on it too; the copy that matters is §4.1's.

That is a smaller problem than the count suggests, and not a trivial one: a
malicious package in this set would run with the developer's privileges during
`npm ci` or `expo export`. It is why installs are lockfile-only.

**The blocker this section carried is cleared.** It read ⛔ _"owner decision:
upgrade to a current Expo SDK"_, and said that upgrade was "the single action
that clears 30 of the 31 advisories". The upgrade landed (PR #65) and the claim
was half right: it cleared the critical and the shipped chain, and it did not
clear the tooling count. There is no longer one action that clears the rest —
each remaining advisory is a transitive dependency of `@expo/cli` or
`jest-expo`, fixable only when Expo itself bumps it.

**Standing position:** these are accepted and recorded, not fixed, because
nothing in this set reaches a phone and `npm audit fix --force` on a build
toolchain is how a working SDK install is broken. Re-derive the split when §5
says to; do not act on the total.

## 5. When this document must be revisited

| Change                                | Effect                                                 |
| ------------------------------------- | ------------------------------------------------------ |
| Any new or removed runtime dependency | §2's table, and the capability line the rule asks for  |
| An Expo SDK upgrade                   | §4 in full — a new build tree is a new §4.2            |
| A `zod` major upgrade                 | §4.1 stops being an accepted risk; re-run its measures |
| React Navigation reacquiring a parser | §4.1's resolved note, and `link-guard`'s standing      |
| A new permission-raising library      | §3, `store-privacy.test.ts`, and W-02's questionnaires |

The SDK-upgrade row has fired once already — §4 was re-measured on 2026-11-01
after PR #65 — and that is the pattern: this file is re-derived from a fresh
`npm audit`, never edited to match a remembered number.

---

_Counts in §4 were measured, not estimated. The triage in §4.1 and §4.2 is the
part that has to be re-read when they change._
