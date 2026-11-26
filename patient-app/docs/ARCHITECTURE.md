# Patient mobile — client architecture

**Checklist row:** A-03, A-08, T-10 · **Audit:** §12
**Status:** implemented. Everything below describes code that exists in this tree.

---

## 1. Stack, and why each choice is not new

Every choice matches something the repository already uses, because a graduation
project with three clients cannot afford a fourth set of conventions.

| Concern | Choice | Why not the alternative |
|---|---|---|
| Framework | **React Native 0.88 + Expo SDK 58** (`react-native@0.88.1`, `expo@~58.0.23`) | Expo ships `expo-secure-store` (the keychain), OTA updates and EAS as first-party. Bare RN means assembling community modules and two native toolchains |
| React | **19.3.0** | Pinned exactly; the version `react-native@0.88.1` declares as its peer. `frontend/` is still on React 18 (`^18.3.1`), so the two trees no longer share a React major |
| Language | **TypeScript `strict`**, plus `noUncheckedIndexedAccess` | Matches both existing trees |
| Navigation | **React Navigation 7** (native-stack + bottom-tabs) | Expo Router was rejected: file-system routing makes the auth gate implicit, and this app's gate is the most important thing in it |
| Server state | **TanStack Query 5** (`^5.62.0`) | Same major and minor range as `frontend/`. The key-factory pattern ports directly |
| Forms | **React Hook Form + Zod**, `@hookform/resolvers` | Same as `frontend/`. Schemas mirror the backend DTOs field for field |
| Styling | **StyleSheet + a typed theme through context** | NativeWind adds a Babel/Metro transform for a shorthand and does not make the token set more faithful |
| Secure storage | **`expo-secure-store`** | Refresh token, and the non-identifying session guard beside it (D-15, T-11) |
| Durable preferences | **`@react-native-async-storage/async-storage`** | Theme, locale and the onboarding flag, and nothing else (E-02, P-07). Ships inside Expo Go, so no development build; the port in `storage/ports.ts` is unchanged |
| HTTP | **`fetch` + a hand-written client** | A port of `frontend/src/api/client.ts`. Axios buys nothing this already does |
| Icons | **`@expo/vector-icons` (Feather)**, with `expo-font`/`expo-asset` for its glyph font | Closest available sibling to the web app's lucide-react |
| Testing | **Jest + React Native Testing Library** | The repo's test-first gate |

**Dependency discipline.** Every addition beyond this list needs a line in the
checklist naming the capability that requires it. Installs are lockfile-only, and
the Expo SDK — not this file — decides the *version* of every module it ships
(`src/test/sdk-versions.test.ts`). `docs/DEPENDENCIES.md` holds the runtime list,
what was removed on 2026-09-12 for being declared and never imported, and the
audit with its triage.

### Deliberately absent

| Not installed | Why |
|---|---|
| `react-native-mmkv` | Still a TurboModule needing a development build, and B-07/W-03 — the rows that would produce one — are blocked on credentials and a device. The three durable non-PHI preferences it was wanted for are now served by AsyncStorage, which ships inside Expo Go and carries a maintained Jest mock. The port is unchanged, so MMKV remains a one-file swap if a development build ever makes it worth the speed |
| `expo-screen-capture` | Its one useful call, `preventScreenCaptureAsync`, sets Android's `FLAG_SECURE` — a native module, so a development build. What it adds over `privacy/PhiPrivacyShield.tsx` (§7) is blocking a *deliberate* screenshot, not the switcher snapshot T-09 asks for. Install it with the first development build |
| `expo-notifications` | There is no push endpoint and no provider (BE-12). Installing it would let the app request a permission it cannot use |
| `i18next` | **Still not installed, and now deliberately so rather than by default.** C-09 landed the typed-catalogue pattern from `frontend/src/i18n/` in `src/i18n/`: two locales, one bundle, no async load, and catalogues that are total by type — so the fallback chain, loader and detector i18next would bring are unused, and its plural rules would need their own decision when a message needs one. **One message did need one** — the background-timeout notice names a number of minutes, and Arabic has a singular, a dual, a paucal for 3–10 and the numeral form above that. That decision is `src/i18n/duration.ts`: one formatter, two languages, tested at all six cases, and no general plural machinery for the catalogue to grow around. Revisit if a locale arrives that cannot be expressed this way |
| `expo-location` | Nothing in v1 needs coordinates. There are no geo columns anywhere in the schema (audit §8), and the maps hand-off works from an address string with no permission at all |

---

## 2. Tree

```
patient-app/
├── index.ts                     Expo entry → src/bootstrap/App
├── app.json · eas.json · metro.config.js · babel.config.js
├── assets/                      icon · adaptive-icon · splash (W-01), generated
├── scripts/                     generate-app-icons.mjs — rasterises the brand mark
├── docs/                        ARCHITECTURE · TRACEABILITY · PUBLIC_PROJECTIONS
└── src/
    ├── bootstrap/               App.tsx (the provider stack) · ErrorBoundary
    ├── configs/                 Zod-validated environment
    ├── api/                     client · errors · seam · query-client · query-keys · optimistic
    │   └── endpoints/           ONLY routes that exist. Today: auth.ts · account.ts
    ├── schemas/                 response-validation infrastructure
    ├── types/                   api.ts · vocabularies.ts (backend literals, verbatim)
    ├── theme/                   tokens · typography · spacing · motion · ThemeProvider
    ├── components/              primitives · feedback/ · layout/ · form/
    ├── navigation/              RootNavigator · AuthStack · AppTabs · linking · routes
    ├── storage/                 ports · secure-store · preference-store
    ├── network/                 NetworkProvider
    ├── privacy/                 PhiPrivacyShield — the task-switcher cover
    ├── accessibility/           a11y helpers · useReducedMotion
    ├── utils/                   logger (redacting) · datetime · id
    ├── features/                auth · emergency · home · doctors · clinic ·
    │                            appointments · health · messages · notifications ·
    │                            profile · support · app-version
    └── test/                    setup · render · parity · projections · security
```

Each feature is `model/` (DTOs + the service port) · `fixtures/` · `service.ts`
(the seam selection) · `hooks.ts` · `components/` · `screens/`.

---

## 3. The layering rule

```
screens  →  hooks (TanStack Query)  →  service (the seam)  →  endpoints  →  ApiClient  →  NETWORK
    ↑                                                                          ↓
components (presentational, no fetching)                          errors.ts → typed error union
```

- A screen never calls `fetch`, never calls a service directly, never calls `apiClient`.
- A component never calls a hook that fetches.
- Only `service.ts` reads `env.enableMocks`, and only through `selectService`.

`import/no-restricted-paths` in `eslint.config.mjs` makes the platform-layer half
of this a build failure rather than a review comment.

This is what makes the fixture → HTTP swap a **one-line change per feature**.

---

## 4. The seam

Many of the endpoints this app needs still do not exist. Rather than mock them
inside screens, each feature has a port and two adapters:

```ts
export const messagingService: MessagingService = selectService({
  fixture: fixtureMessagingService,
  http: unavailableService<MessagingService>('AD-1 / BE-13', 'capability.messages', [...]),
});
```

`unavailableService` is the honest shape for a route that does not exist: in a
production build every method rejects with `EndpointNotImplementedError`, naming
its blocking dependency, and `ErrorState` renders "not available yet" rather
than a failure the patient could retry past.

### 4.1 Which side of the seam each feature is on

**This table is the single source of truth for the split**, and
`src/test/docs-consistency.test.ts` fails if it drifts from
`src/features/*/service.ts`. Every other document points here rather than
repeating a count that goes stale the next time an endpoint lands.

<!-- seam-table:start -->

| Feature | HTTP adapter | Blocked on |
|---|---|---|
| `ai` | `httpAiService` | — |
| `appointments` | `httpAppointmentService` | — |
| `auth` | `httpAuthService` | — |
| `clinic` | `unavailableService` | BE-11 |
| `doctors` | `httpDoctorService` | — |
| `emergency` | `unconfigured` | BE-11 |
| `health` | `httpHealthService` | — |
| `home` | `unavailableService` | BE-10 |
| `messages` | `unavailableService` | AD-1 / BE-13 |
| `notifications` | `httpNotificationService` | — |
| `profile` | `httpProfileService` | — |

<!-- seam-table:end -->

Two of those rows carry a caveat the single word "live" would hide:

- **`doctors`** is live except `listDepartments`, which refuses by name because
  `GET /patient/departments` (M23) is unbuilt. A service may be live in nine
  methods and honest in the tenth.
- **`appointments`** is live for the two **read** routes and for nothing else.
  The four write routes are blocked on ADR-033, which is a policy decision
  rather than an unbuilt endpoint, and no client-side slot arithmetic stands in
  for it.
- **`health`** is the patient-facing information layer only (ADR-050): test
  **status** (`GET /me/lab-orders`) and the insurance on file
  (`GET /me/insurance`). It is live in those two methods and refuses by name in
  `listEmergencyContacts` (BE-09). The medical record, physician notes,
  prescriptions, visit summaries, documents and lab **results** are not behind
  the seam at all — a patient never sees them in the app (owner decision,
  2026-11-26), and results stay unexposed until the ADR-031 release policy is
  approved. Their screens, routes and fixtures were deleted, not left refusing.
- **`ai`** is the patient assistant: two separate experiences, "Health
  assistant" (`general`, given no patient data) and "My care assistant"
  (`personal`, grounded server-side in appointments, test status and insurance
  — never results or records), over `/me/ai/conversations`. The reply is
  `text/event-stream`, read over `expo/fetch` streaming by
  `ApiClient.openStream`; where the runtime exposes no readable body the whole
  text is read after completion and parsed the same way. The server answers 503
  until a provider is configured, which the screens render as "not available
  yet"; the mock-build fixture refuses with the same 503 and **never scripts a
  reply**.
- **`messages`** stays blocked (owner decision): `unavailableService` in a
  production build, fixture threads in mock builds only.
- **`emergency`** is not `unavailableService` but `unconfigured` — the screen
  works entirely offline from bundled content, and it is only the
  operator-supplied numbers that are absent. It says so rather than showing a
  plausible number.
- **`home`** is the recent-activity feed alone (F-06), not the screen: Home's
  other sections read the appointments and notifications features. It is the
  one refusal a patient never sees, because `RecentActivity` renders nothing
  at all rather than an error card on the app's front page.

### 4.2 No invented path strings

**There is no invented path string anywhere in this tree**, and
`src/test/parity.test.ts` asserts it module by module: each file in
`api/endpoints/` may name only the routes its backing controller actually
exposes, and the directory listing itself is pinned so a ninth module cannot
appear without that test being updated deliberately.

The nine modules and what backs each:

| Module | Controller | Checklist |
|---|---|---|
| `auth.ts` | `auth.controller.ts` | D-01…D-12 |
| `account.ts` | `account-password.controller.ts`, `two-factor.controller.ts`, `account.controller.ts` | P-05, D-16, P-03 |
| `doctors.ts` | `patient-doctor.controller.ts` | G-01…G-08 |
| `appointments.ts` | `patient-appointment.controller.ts` (reads only) | I-01, I-02, I-06 |
| `notifications.ts` | `notification.controller.ts` | O-01, O-02 |
| `profile.ts` | `self-profile.controller.ts` | P-01, P-02 |
| `patient-info.ts` | patient information controller (CONTRACT §4; pending in this worktree) | ADR-050 |
| `patient-ai.ts` | patient assistant controller (CONTRACT §6; pending in this worktree) | ADR-050 |
| `sessions.ts` | `account-security.controller.ts` (two routes of eight) | P-06 |

Two rows there moved when the backend did, and neither changed a line of this
client:

- `profile.ts` was backed by `patient-profile.controller.ts` until **ADR-036**.
  `PATIENT_MOBILE_API_CONTRACT.md` §2.1 and API §3.1 named one path for two
  documents, so the route moved to `UsersModule` and answers
  `{ account, patient, doctor }` — additive for this client, which reads the
  same two halves and ignores the third.
- `sessions.ts` did not exist while `GET /me/sessions` did not. **M8** shipped
  it, and the swap was the one line the seam exists for.

`sessions.ts` reads **two** of the eight routes on its controller. `/me/devices`
and `/me/login-history` are live and are deliberately not called: neither is on
the profile port, and putting a trusted-device list and a sign-in history on a
patient's screen is a product decision rather than an adapter's.

#### `GET /auth/session` is built, and is still not called (D-13)

It used to be the one specified-but-unbuilt route worth naming here. **M8 built
it**, and the conclusion did not change — for a better reason than before.

`SessionUserService.current()` returns `{ id, name, email, role, permissions }`
and refuses a non-`ACTIVE` account. `RefreshService.refresh()` returns *the same
five fields* under `user`, applies *the same* status check, and revokes the
session when it fails. So the route is a strict subset of a response this client
already has in hand at exactly the moment it would call it — cold start, having
just exchanged the refresh token.

Calling it would therefore add a round trip to the cold-start path, which W-08
budgets, in exchange for no field this client does not already hold. Two of the
five it *would* carry — `role` and `permissions` — are fields
`AuthenticatedIdentity` deliberately does not have, because T-07 makes every
authorization decision the server's.

So D-13 is no longer blocked on BE-03, and no path string for `auth/session`
exists in this tree. The one case it would answer that refresh does not — a
revalidation on **resume**, while the access token is still live — is a
behaviour nobody has asked for, and inventing it to spend a route would be the
tail wagging the dog.

A module joins that list only with a controller behind it. `account.ts` is the
first row of the checklist to graduate from 🟨 to ✅ by that route: the port
(`AuthService.changePassword`) and the screen were written the same way every
fixture-backed feature is written, and landing the endpoint changed one adapter.

`account.ts` has since grown the three `me/2fa/*` routes (checklist D-16), which
`two-factor.controller.ts` serves today. Two decisions there are worth keeping:

- **The enrolment goes to the authenticator through its `otpauth://` link, not a
  QR code.** A QR needs `react-native-svg` and a QR library — two dependencies,
  one native — to draw a picture a patient cannot scan off their own screen. The
  link is one tap and costs nothing; the base32 secret is shown underneath for a
  second device.
- **No on/off state is displayed.** There is no `GET /me/2fa` in the contract and
  no flag on any login or refresh response, so the client cannot know whether 2FA
  is on. Inferring it from a past `otp_required` would be the screen asserting
  something it was never told. Both actions are offered as actions, and only what
  has just happened in the session is reported.

---

## 5. Offline policy

| Tier | Content | Where | Rationale |
|---|---|---|---|
| **Bundled** | Emergency guidance, disclaimers, red flags | The app bundle | Must render with no network and no session |
| **Secure** | Refresh token | Keychain / Keystore | Nothing else |
| **Non-sensitive** | Theme, locale, onboarding flag | `PreferenceStore` (AsyncStorage, hydrated at boot) | Never PHI |
| **Memory only** | Access token, appointments, records, messages, recently viewed doctors | `ApiClient` + the query cache + `features/doctors/recent.ts` | **PHI is never written to disk** |
| **Never** | PHI in any store, token in any store but the keychain | — | — |

Recently viewed doctors (G-10) sit in that last tier deliberately, even though
the row that asks for them calls them a non-PHI cache and suggests MMKV. Each
doctor in the list is public — the patient-safe projection is what a clinic
prints on its own website — but the *list* is which specialists this patient
looked at, and that is an inference about their health. R-8's phone-in-a-taxi
reasoning reaches it, so it is cleared in `endSession` alongside the query cache
and never written anywhere.

**Reads degrade. Writes refuse.** There is no mutation queue and there must not
be one: a booking replayed three hours later against a slot that no longer
exists is worse than a clear "you're offline" the patient can act on.

### The cache is told about connectivity, and `networkMode` is why that is safe

`NetworkProvider` sets TanStack Query's `onlineManager` from the same NetInfo
subscription that raises the banner. Until 2026-09-12 it did not, and the
consequence was quiet: `query-client.ts` asks for `refetchOnReconnect`, the
library's default connectivity listener is the browser's `online`/`offline`
events, and React Native fires neither — so the cache believed it was online
forever, no reconnect ever happened, and a patient who lost signal in a lift had
to find Retry on every screen when it came back.

Wiring it makes `networkMode` load-bearing, so both clients pin it to
**`'always'`** rather than taking the default. The default is `'online'`, which
*pauses* rather than fails:

- a first read would sit in `isPending` with nothing behind it, which every
  `AsyncBoundary` renders as a skeleton that never resolves, where R-04 asks for
  the offline error state;
- a mutation would be **held and replayed on reconnect** — the mutation queue
  the paragraph above forbids, arriving as a library default rather than as a
  decision.

So the only thing connectivity changes is that what is on screen re-asks when
the signal returns. `src/network/network.test.tsx` holds all three: the
reconnect refetch, the read that fails instead of pausing, and the write that is
not replayed.

### Optimistic writes (R-07)

`api/optimistic.ts` is the one pattern: cancel any in-flight refetch for the
key, snapshot every matching query, apply, and on failure restore the snapshot
and tell the call site so it can say so. `onRollback` exists rather than letting
a call site pass its own `onError`, because an `onError` written next to the
spread would silently replace the rollback.

**Where optimism is allowed is a rule, not a preference.** It is a claim about
what the server will do, so it is honest only where the client already knows the
answer — today that is the read state of a notification, which is the patient's
own. **Appointment status is never optimistic:** `pending → confirmed` is the
clinic's decision, the actions come from the server (F-03, I-04), and an
appointment that reads `cancelled` for a second because this client assumed so
is a clinical falsehood on screen.

---

## 6. Timezone contract (A-08)

The server stores UTC and returns ISO-8601 UTC. **The client formats; it never
computes.** A slot's local time, a "closed today", a DST boundary — all of those
are the clinic's timezone applied server-side (`localization.timezone`).

`utils/datetime.ts` contains formatters and one relative-time helper. It contains
no arithmetic on a clinic rule, and it must not gain any: a second implementation
of "is the clinic open?" disagrees with the first on the last Sunday in October.

The relative form ("tomorrow") is a hint, always rendered *beside* an absolute
time and never instead of one. It counts **calendar days** in whichever zone the
time beside it was rendered in, so the two cannot disagree at the edge of a day.

### 6.1 Which zone the absolute time is rendered in

**An appointment renders in the clinic's zone. Everything else renders in the
device's, because nothing else has a zone to render in.**

This section used to say the second half only, and called the first half a gap
"not fixable here yet" because it "needs `localization.timezone`, which arrives
with `GET /public/clinic` — **BE-11**, unbuilt". That was wrong about
appointments, which are the times it matters most for: `GET /me/appointments`
has returned **`clinicTimezone`** on the page and on the detail since it was
written, `api/endpoints/appointments.ts` documented what to do with it
("format with it; never compute"), the response schema parsed it — and the
mapper dropped it on the floor. A patient in London read **07:30** for their own
09:30 Amman appointment, and nothing on the screen said which zone it was.

What renders where, and why:

| Screen | Zone | Because |
|---|---|---|
| Appointment card, detail, event history, Home's next appointment | **The clinic's**, from `Appointment.clinicTimezone` | "Today" is a question about the clinic's zone: a travelling patient changes their device zone, not their appointment |
| Everything else — a prescription's date, a notification's timestamp, a device's last-seen | The device's | No other payload carries a zone. Guessing one would be worse than the gap |

`clinicTimezone` is `string | null` on the model: `null` where none was supplied
(a fixture, or a payload from before the field existed), and the formatters then
use the device's zone. **This client still invents no zone.** `timeZone` is an
optional argument on every formatter, and `datetime.test.ts` asserts that the
file contains no IANA name, no literal `timeZone:`, and no
`resolvedOptions().timeZone` except the one comparison that answers "is this the
zone the phone is already in?".

That comparison is what `AppointmentDetailScreen` uses to decide whether to say
so. When the two zones agree — most patients, most of the time — the note is
noise; when they do not, its absence is how somebody arrives three hours early.

**The rest of BE-11 is still the gap it was.** Opening hours, a clinic page's
"closed today", and a slot picker all need the clinic's zone for things this
client must not compute anyway; those stay server-side, and §6's first paragraph
is unchanged.

---

## 7. Security posture

| Rule | Where it is kept | Test |
|---|---|---|
| No secret in the client | `configs/env.ts` — three public values, and production+mocks is refused | `security.test.ts` |
| Refresh token in the keychain only | `storage/secure-store.ts` is the only importer of `expo-secure-store`; ESLint enforces it | `security.test.ts`, `session.test.ts` |
| Access token in memory only | A private field on `ApiClient`. `TokenStorage` has no API that could accept it | `session.test.ts` |
| No PHI on disk | There is no persistence layer that could take it | `security.test.ts` |
| No PHI in logs | `utils/logger.ts` redacts by field name; it is the only sanctioned `console` caller | `security.test.ts` |
| 401 refreshes once, then logs out once | `ApiClient.refreshOnce` + `setSessionLostHandler` | `client.test.ts` |
| A wrong password is not an expired session | `isTokenExpiryError` branches on the envelope `code` | `client.test.ts` |
| 403 is never retried or masked | `shouldRetry` | `client.test.ts` |
| State cleared on logout and session loss | `SessionProvider.endSession` | `session.test.ts` |
| A backgrounded app sheds PHI, then the session | `features/auth/lock-policy.ts`, applied in `SessionProvider` | `lock-policy.test.ts`, `session.test.ts` |
| No PHI in the task-switcher snapshot | `privacy/PhiPrivacyShield.tsx`, wrapped around the navigator in `App.tsx` | `privacy.test.tsx` |
| **Frontend authorization is presentation only** | No screen grants access; every guarded call also fails server-side | — |

### Background timeout (T-11) — two thresholds, not one

"No PHI on disk" says nothing about the copy already in RAM. A phone left on a
table with Medora in the app switcher still holds an open records screen and a
live access token, so the time spent in the background is graded:

| Away for | Action | Cost to the patient |
|---|---|---|
| < `EXPO_PUBLIC_PHI_SWEEP_MINUTES` (default 5) | nothing | — |
| ≥ the sweep threshold | the query cache is emptied | a refetch |
| ≥ `EXPO_PUBLIC_REAUTH_MINUTES` (default 15) | the session ends | signing in again |

A single aggressive timeout is a gate patients defeat by never backgrounding the
app; ten minutes in a waiting room is not an abandoned phone. Past the second
threshold that reasoning stops holding.

**The session ends rather than hiding behind a lock screen.** A lock screen has
to remember who is locked out of it, and `features/auth/storage.ts` refuses that
in as many words — *a convenience field on a lock screen is a patient identifier
on a lost phone*. Ending the session needs no such record, and reuses the
expired-session path D-12 already builds. It cannot be walked past by
force-quitting the app only because the absence is also written to the
non-identifying session guard (`features/auth/session-guard.ts`): a process
killed in the background never runs the foreground handler, so the cold start
applies the same decision before the stored token is presented. The login screen distinguishes it from
an expired session in so many words, because a form that appears with no
explanation reads as a crash. Biometric app-unlock (D-15) is a layer on top of
this, not a substitute.

The decision itself is a pure function in `lock-policy.ts`, so it is asserted at
its boundaries without an `AppState` transition or a fake clock.

### Biometric app-unlock (D-15) — the screen, not the token

`SecurityScreen` used to carry a note arguing that a biometric gate would be a
**fake control**, since the refresh token stays in the keychain whatever the
screen shows. That note was right about the mechanism and wrong about the
threat, and the resolution is written into `features/auth/biometrics.ts`.

It protects the **screen**, against what patients actually meet: a phone handed
over to look at a photo, or picked up off a desk, with Medora already open and
signed in. T-11's five-minute sweep empties the cache and deliberately leaves
the session standing, so a waiting room does not sign anyone out — that window
is what this closes. It protects nothing against an attacker who can read the
keychain, and the toggle's own copy says so.

| Decision | Why |
|---|---|
| **Opt-in, off by default** | A patient who never opens Security is never locked out of anything |
| It raises only on the `sweep-phi` return | On `reauthenticate` the session has already ended, so a lock would ask for a fingerprint to reach a password field. On `none` the patient glanced at a notification, and locking there is what makes people switch the feature off |
| Only a non-identifying **session guard** is persisted | A stored lock that remembered *who* is locked out of it is what `features/auth/storage.ts` refuses. The guard (`session-guard.ts`) holds whether a lock was up or owed, when the app last left the foreground and the opt-in at that moment — no identifier — in the keychain beside the refresh token, removed with it. Without it, a force-quit while locked, or a kill in the background, restored the session unprompted |
| A cold start applies the same T-11 / D-15 decision | Before the stored token is presented: past the re-auth threshold the session ends; a lock that was up or owed comes back up; an unreadable guard signs out without deleting anything |
| **Approved owner decision (2026-11-22):** past the re-auth threshold, a cold start asks **every** patient for the password, opted in to biometrics or not | The owner weighed the frequency — with the default `EXPO_PUBLIC_REAUTH_MINUTES=15`, most cold starts after a quarter of an hour away (OS memory reclaim, reboots, force-quits) end at the sign-in form — and kept it. It is T-11's long-absence rule, which a warm return already applied to everyone, now also holding when the process did not survive the absence. Not to be relaxed, or made opt-in only, without a new owner decision |
| The lock screen **names nobody** | A screen that greets the patient by name is a patient identifier readable by whoever is holding the phone — the person it exists to stop |
| It **replaces** the navigator rather than covering it | An overlay leaves the records screen mounted, and the OS photographs what is mounted on the way to the task switcher. The T-09 reasoning, applied again |
| `disableDeviceFallback: true` | The OS passcode unlocks a phone that is already unlocked. Offering it would let exactly the wrong person through |
| Every failure reaches "Use your password instead" | It ends the session — the same `logout()` the profile screen calls, keychain and cache included. A patient with a cut finger must never be one broken sensor away from an uninstall |

`expo-local-authentication` is the only permission-raising library in the tree,
and it moved `docs/STORE_PRIVACY.md` §1 from "no runtime prompt" to one prompt,
named. No biometric data reaches this app: the template never leaves the
phone's secure enclave, and the API answers yes or no.

---

### The task-switcher snapshot (T-09)

Both platforms photograph the app as it leaves the foreground and show that
photograph in the task switcher. A patient who opens their lab results and then
switches apps has left a thumbnail of those results behind — reachable with no
unlock, no app launch and no session. None of the rules above touch it: by then
the PHI is not on disk, not in a log and not in a cache, it is **on the screen**,
which is precisely what is photographed.

The snapshot is taken on the transition out, so an opaque cover rendered on that
transition is what lands in the photograph. It is removed on the way back and the
patient returns to the screen they left. This is a cover, not a lock — a cover
costs nothing, and the lock is T-11's separate and more expensive decision.

**It covers the whole app while a session exists, rather than the PHI screens.**
`clearPhiCache` lists the PHI domains explicitly *and then* clears everything,
because the failure nobody catches in review is the feature that forgot to
register; a per-screen opt-in here is one forgotten prop away from a records
screen in the switcher. Signed out there is nothing to protect, and Welcome and
Emergency are public by design.

Two limits, recorded rather than hidden:

- It covers the **switcher snapshot**, not a deliberate screenshot. Preventing
  that needs `FLAG_SECURE` through `expo-screen-capture` — a native module, so a
  development build, which is the same reason MMKV is absent (§1).
- A screen presented as a **native modal** by `react-native-screens` may sit
  above a JS overlay on iOS. The screens T-09 names — records, lab results,
  prescriptions, documents, messages — are stack screens; the app's two modals
  are Emergency and Booking, and neither renders a record.

### Transport hardening (T-10) — decision recorded

**Certificate pinning is NOT implemented, and that is a decision rather than an
omission.** Pinning a certificate in a mobile binary means that a certificate
rotation the operator performs bricks every installed copy until an app-store
review completes — days, not minutes. It is worth that cost only for an app
handling credentials against a server whose CA chain is not otherwise trustworthy.

Revisit if: the deployment moves to a network where TLS interception is expected,
or a threat model naming a MITM adversary is written. Until then, TLS with the
platform trust store, `expo-secure-store`, and no PHI on disk are the controls.

#### TLS is now required rather than assumed (T-14)

That last paragraph said "TLS with the platform trust store" was a control, and
until 2026-09-14 **nothing enforced it**. `EXPO_PUBLIC_API_BASE_URL` was validated
with `z.string().url()`, which accepts `http://api.medora.example/api/v1` in a
production build exactly as readily as the `https:` one — and the shipped default
is `http://localhost:3000/api/v1`, so an operator who never set the variable got a
cleartext production build rather than a loud failure. Pinning a certificate would
have been the *second* control on a channel with no first one.

`src/configs/env.ts` now refuses at boot. The rule is a pure function,
`apiBaseUrlRejection(url, appEnv)`:

| Condition | Result |
| --- | --- |
| Scheme is not `https:` or `http:` | Rejected. `z.string().url()` accepted `javascript:`, `file:` and `data:`, and this value is concatenated into every request |
| `https:` | Accepted, in every environment |
| `http:` and `APP_ENV` is not `development` | Rejected. Staging holds real accounts; it is not a laxer production |
| `http:`, `development`, host is loopback / `10.0.0.0/8` / `172.16.0.0/12` / `192.168.0.0/16` / `169.254.0.0/16` | Accepted |
| `http:`, `development`, any other host | Rejected. A `.env` copied to a shared machine is the case this catches |

The private ranges are named rather than implied: `10.0.0.0/8` covers the Android
emulator's `10.0.2.2` host alias, and `192.168.0.0/16` covers a physical device on
the developer's Wi-Fi. A rule that cannot be followed locally is a rule that gets
switched off, so the local case is inside the exception by name.

Certificate pinning remains out, for the reasons above. The difference is that the
channel it would be pinning is now guaranteed to exist.

### Forced upgrade (W-06) — the one lever over an installed build

A web deployment replaces itself on the next page load; a defect can be withdrawn
in minutes. **An installed app cannot be force-refreshed** (MG §15.5). A build
with a broken token path or a disclosure defect keeps running on the patient's
phone until they choose to update, through a store review queue measured in days.
The only lever the operator has is the ability to tell an old build to stop — and
that lever has to ship *before* the first release, because adding it in version 2
does nothing for the copies of version 1 already installed.

| Decision | Why |
|---|---|
| The floor arrives as the **`X-Minimum-App-Version` response header** | There is no version endpoint in the API contract and inventing one is forbidden (§4 above). A header on a call the client was making anyway invents no route and costs no request |
| The gate sits **above the auth stack** | A build gets withdrawn *because* of how it handles a session or clinical data. Letting it authenticate first is letting it do the thing it was withdrawn for |
| It **fails open** — absent header, malformed header, unreadable own version all mean "let the patient through" | A gate that fired on a malformed value would let one bad deploy brick every installed copy at once: the exact catastrophe it exists to prevent, pointed the wrong way. The header can only tighten access |
| Once tripped, it **stays tripped** for the life of the process | A response that fell back to a cache, or hit a stale instance behind a rollout, must not silently reopen a build the operator has closed |
| The store link is **optional configuration**, not a hardcoded URL | There is no published listing yet (W-01, W-03). Unset, the screen says what to do in words rather than offering a button that goes nowhere — the rule N-04 applies to emergency numbers |

**The backend does not send the header yet.** `docs/DECISIONS.md` records
deprecation headers as part of RM **M41.2**, which is untouched, so the gate is
built, tested and inert. When M41.2 lands and agrees the spelling, it starts
working with no client change — the same honest shape `unavailableService` takes
for absent endpoints.

### Reaching a human (W-11)

`mailto:`, not a form. A form needs an endpoint and there is none — inventing one
is forbidden (§4) — while `mailto:` reaches a real channel with no route at all:
the patient's own mail app opens with the message ready, they see exactly what is
sent, and the reply lands where they already read.

The address is **optional configuration** (`EXPO_PUBLIC_SUPPORT_EMAIL`), for the
same reason the store link is: unset, the screen says how to reach the clinic in
words rather than offering a button that fails silently.

Two safety properties matter more than the plumbing:

- **The emergency number comes before the contact button**, and the screen says
  in as many words that the inbox is not monitored for medical emergencies. A
  patient who mistakes support for a clinical channel is a patient waiting for an
  answer that is not coming.
- **The prefilled message carries the build and the platform, and nothing else.**
  No PHI, no account identifier, no token. The patient's own address comes from
  their mail app, which is their choice to send; `support.test.tsx` asserts the
  body against a list of words that must never appear in it.

### Deprecation notices (W-07) — the softer half of the same signal

The gate is the emergency stop. `Deprecation` (RFC 9745) and `Sunset` (RFC 8594)
are what should arrive long before it: the server saying the surface this build
calls is on its way out. That is advisory, so it renders as a **banner beside
`OfflineBanner`, never as a gate** — a patient must not be locked out of their
appointments because a version of an endpoint is scheduled for retirement.

| Decision | Why |
|---|---|
| It **fails quiet** — no header, an unreadable value, an unknown spelling all mean "say nothing" | W-06 fails *open* because a wrong gate locks patients out. This fails *quiet* because a wrong banner cries wolf, and a banner nobody believes means the one that matters is ignored too |
| A lone `Sunset` is **not** a deprecation | The two headers are independent in the RFCs. Announcing a retirement the server never declared would be this client inventing a fact |
| Three spellings of `Deprecation` are accepted: `@<unix>`, an HTTP-date, and a bare `true` | The RFC settled on the first; servers in the wild still emit the other two. Discarding a real warning over a spelling helps nobody. `false` means what it says |
| Not dismissible | A dismissal would have to be remembered, and the preference store is in memory today (§5), so "dismissed" would return on the next cold start — a control that lies |

`ApiClient` therefore keeps a **set** of response observers rather than one slot.
Two features now listen to the same responses, and a single slot means whichever
mounts second silently unhooks the first: a forced-upgrade gate that stops
working because somebody added a banner is exactly the failure that API shape
must not allow.

Both headers are pending the same **RM M41.2**, so this is built, tested and
inert until the backend sends them.

### Crash reporting (W-04) — the pipeline, without a provider

`src/utils/monitoring.ts` is the redaction pipeline and the port. It is not a
vendor integration, and the order is deliberate: choosing a crash service for a
health application is a procurement decision — the service becomes a processor
of patient data — while the shape of what is sent to it is an engineering one
that is dangerous to leave until the SDK is already installed.

A provider adapter, when there is one, implements `CrashSink` and receives a
`CrashReport`. It never sees the `Error`, so it cannot read a field this module
decided not to send.

| Decision | Why |
|---|---|
| **`error.message` is never reported** — absent, not redacted | `logger.ts` redacts by *field name*, which works because a log context is an object whose keys a developer wrote. An exception message is a bare string, and inside a records screen it is routinely built from the data that made it throw: `Unknown severity for allergen Penicillin`. There is no key to match on |
| The stack header is removed **by length**, then survivors are filtered to lines shaped like a frame | A message containing its own newlines would otherwise leave its second line behind, and the second line is where an interpolated value lands. The frame filter requires a trailing `:line:col`, which an address or an email does not have |
| A thrown non-`Error` reports as `NonError` with no frames | Its text *is* its message, and the same rule applies |
| Breadcrumbs come through `addLogSink`, never through `console` | A sink attached to `console` sees the arguments before `redact()` ran — the one bypass `logger.ts` exists to prevent, in the consumer that most needs it |
| With no sink registered it is a **no-op** | An unconfigured reporter drops reports rather than inventing a destination, the same rule N-04 applies to an unconfigured emergency number |
| Installed in `index.ts`, before `registerRootComponent` | A crash during the provider stack's own mount is the crash most worth reporting, and an effect-based install runs after the render that would have thrown |
| The engine handler is **chained**, not replaced | The previous handler is the red box in development and the termination in production. A crash the reporter saw must still be a crash the developer sees |

Unhandled *promise* rejections are deliberately not hooked: React Native tracks
them inside its own runtime setup, which is not a stable seam, and the ones that
matter here are already caught — every request goes through `ApiClient` and
every query through TanStack Query's error path.

---

### Analytics (W-05) — an allow-list that is data, not a convention

`src/utils/analytics.ts` declares every event and every value each event's
properties may take, in one `ANALYTICS_EVENTS` object. The types are derived
from it, so an undeclared event does not compile; the same object is checked at
emit, so an undeclared value does not send. There is no function in the module
that accepts an arbitrary string.

| Decision | Why |
|---|---|
| The allow-list is **data**, not only a type | Typing stops at the module boundary. A value arriving from a service, a navigation payload or a `JSON.parse` is `any` often enough that the compiler is not the guarantee to rest a disclosure on |
| An event that fails validation is **dropped whole**, never trimmed | The property that failed is the one most likely to be the free text. Trimming would send a valid-looking event and hide that somebody tried to attach something |
| `TRACKED_SCREENS` is a short, reviewed list, and every clinical route is absent | *Which screens this patient opens* is an inference about their health — the same reason recently-viewed doctors stay in memory (§5). `analytics.test.ts` fails if a clinical route is added |
| A route outside the list is ignored **silently** | Every clinical route is outside it on purpose, so a warning would fire on normal use and train people to ignore it |
| No identifier of any kind — no user, device or session id | Nothing is attributable to a patient, which is what makes the counts safe to hold. Asserted by test |
| `track` is called only with a literal event name | A computed name steps around the compile-time half of the list. Asserted across the tree, not just in the module |
| A screen view is **not counted twice in a row** | `onStateChange` fires for every navigation state change, and most do not change which screen is visible — a params update, a nested navigator settling, a modal closing. Counting those would make "screen views" a measure of navigator churn. A return *through* an untracked screen still counts, because the patient did return |

Four call sites today: `app.launched` in `index.ts`, `screen.viewed` from the
navigator's own state change, and the two halves of the emergency two-step dial
— confirmed and dismissed, **never the number**. `upgrade.gate_shown` is the
fifth, and counts something the server cannot see: a client that has stopped
calling reports nothing by definition.

As with W-04 there is no provider. With no sink registered, `track()` drops the
event rather than queueing it for a destination that does not exist.
`docs/STORE_PRIVACY.md` §5 is the declaration that has to change the day one is
added.

---

---

## 8. Accessibility

Not a cleanup pass. It is built into the primitives:

- `pressableA11y()` **requires** a label, so a control cannot be added without one.
- Every button clears **44dp** at every size, asserted in `components.test.tsx`.
- Typography is pre-scaled from the OS font scale with a **1.6× ceiling**, and
  every `Text` sets `allowFontScaling={false}` so the two do not compound.
- Colour is never the only carrier: a status is a colour **and** an icon **and**
  a word; a form error is a colour **and** an icon **and** a message.
- Contrast is measured, not assumed — `theme.test.tsx` computes WCAG ratios for
  both palettes.
- `useReducedMotion()` returns "do not animate" while the setting is still
  unknown, so a motion-sensitive patient never sees a frame of animation before
  the OS answers.

### Focus order (S-05)

The Return key on a text field does nothing by default: it neither advances nor
submits. On a touch keyboard that costs a patient a dismiss-scroll-tap per field;
on an **external** keyboard — the case S-05 names, and the one a patient with a
motor impairment is most likely to be using — there is no tap to fall back on.

`components/form/useFieldChain.ts` is one hook per form and one prop spread per
field, in reading order:

| Field | Return key | `submitBehavior` | On Return |
|---|---|---|---|
| every field but the last | `next` | `submit` | focus moves to the next field |
| the last field | `done` | `blurAndSubmit` | the form submits |

`submitBehavior: 'submit'` on the intermediate fields is the load-bearing part:
without it every Next closes and reopens the keyboard, and the form jumps under
the patient's thumb. The chain's order is the argument order, which is the visual
order, which is the order a screen reader walks — one list, so the three cannot
drift apart. A field that has not mounted is skipped rather than swallowing the
key press.

`Input` takes `inputRef` as a **named prop rather than a real `ref`**: it is
wrapped by `ControlledInput`, which is generic over the form's value type, and
threading a `ref` through two generic wrappers costs two `forwardRef`s and a cast
to keep the generic. It also now **composes** `onFocus`/`onBlur` with its own
focus state instead of letting a spread overwrite them — that overwrite was a
live defect, because `ControlledInput` passes React Hook Form's `onBlur` through,
so every field a patient touched kept its focus ring for the life of the screen.

**Modal focus trapping is the platform's, deliberately.** `BottomSheet` sets
`accessibilityViewIsModal` and hides the scrim from assistive technology, which
is what actually traps VoiceOver and TalkBack inside the sheet and restores focus
on dismissal. Hand-rolling a focus trap on top of that would fight the OS rather
than help it, and would have to be re-verified against every RN upgrade. The row
is met by leaving it alone.

---

## 9. What this tree does not decide

| Question | Owner | Consequence here |
|---|---|---|
| ~~Do patients authenticate? (**AD-1**)~~ **Decided** — ADR-030, accepted 2026-09-02 | Was: backend / project owner | `AuthenticatedIdentity` still has a `subjectId` rather than a `userId` or a `patientId`, and that survives the decision on purpose: the client is not the thing that should know which of the two a subject is. What changed is that `api/endpoints/auth.ts` now sends `role: 'patient'` at `POST /auth/register` — as a constant in the adapter, never a form field — and `parity.test.ts` fails if the backend's `register.schema.ts` stops accepting it |
| **RA-030.1** — binding an account to a `PT-…` record | Project owner, deferred inside ADR-030 | The claim flow (A-02, D-14). A registered account is linked to no record until this exists; auto-linking on email is ruled out by ADR-030 §5 |
| **ADR-033** — the patient booking policy | Product / clinical owner | Every appointment **write** (I-03…I-10). The reads are live; the writes are not endpoints waiting to be called but a policy nobody has written. No client-side slot arithmetic stands in for it |
| Which fields may a patient edit? (**AD-2**) | Product | `ProfileField.editable` is server-supplied |
| Multi-facility and geo (**AD-3**) | Product | ~~Out of v1. One "Our Clinic" screen~~ **Reversed 2026-10-06** by the owner's multi-organization decision: hospital, clinic and medical-center discovery is in scope and available signed out; "Our Clinic" becomes an organization profile; nearby and distance stay future and need real location data. The APIs are the Backend team's (`PATIENT_FRONTEND_CHECKLIST.md`, API-P01…P08) ⚠ **Superseded in part 2026-10-07 by the FINAL Multi-Hospital decisions** (`docs/multi-hospital/OWNER_DECISIONS.md`): discovery of hospitals (with clinics and multiple locations) is in scope **after sign-in only** (DR-09) — never signed out; distance and ratings/reviews are in scope for signed-in comparison (OD-10); insured patients get insurance-aware results and uninsured patients are unrestricted (OD-14); "Our Clinic" becomes a hospital profile. Contracts: `docs/multi-hospital/API_CONTRACT_CHANGES.md` §5–§6 |
| Patient AI safety (**AD-4**) | Clinical owner | **No AI entry point exists in this app** — not disabled, not "coming soon" |
| Results-release policy (**AD-5**) | Clinical owner | Every record carries a server-supplied `ReleaseState`; the client renders it and decides nothing |
