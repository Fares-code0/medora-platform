# Store privacy declarations — App Privacy and Data Safety

**Checklist row:** W-02 (P0) · **Depends on:** T-03
**Status:** **DRAFT — derived from the code, awaiting owner sign-off.**
**Measured against:** `patient-app/` at the commit that introduced this file.

> **An inaccurate declaration is a compliance failure, not a form error.** That
> is the row's own wording, and it is why this document exists in the
> repository instead of being typed straight into a store console: a
> declaration written from memory in a web form cannot be reviewed, cannot be
> diffed, and cannot be tested. This one is derived from the code, cites the
> file behind every line, and is guarded by `src/test/store-privacy.test.ts`,
> which fails when the app starts doing something the declaration does not
> mention.

---

## 0. What this document is, and what it is not

**It is** the engineering input to the two store questionnaires: Apple's *App
Privacy* (App Store Connect) and Google's *Data safety* (Play Console). Every
answer below is a fact about this codebase that a reviewer can check.

**It is not** the submission itself, and it is not legal advice. Two of the
questions those forms ask cannot be answered from the code at all, and they are
named in §6 rather than guessed.

**It describes the app, not the platform.** What the *backend* stores, how long
it retains it, and who at the clinic can read it are governed by the backend's
own documents and by the clinic's policies. The store forms ask about the app's
collection and transmission, which is what is described here.

---

## 1. The short version

| Question the forms ask | Answer | Where the code says so |
|---|---|---|
| Does the app collect data? | **Yes** — account details, and it displays health data from the clinic | `features/auth/schemas.ts`, the `/me/*` routes |
| Is any of it used for tracking? | **No.** No advertising identifier, no cross-app tracking, no third-party SDK of any kind | `package.json` — no analytics, ads or attribution dependency |
| Is any of it linked to identity? | **Yes** — everything is. The app is an authenticated patient client; there is no anonymous mode | `features/auth/SessionProvider.tsx` |
| Is any of it shared with third parties? | **No.** The app talks to one host, the clinic's API | `configs/env.ts` — one base URL, no second host |
| Analytics? | **None collected.** The W-05 allow-list exists, but no sink is registered and no provider SDK is installed, so no event leaves the device. Nothing in the catalogue carries an identifier or free text | `utils/analytics.ts`, `package.json` |
| Crash reports? | **None collected.** The W-04 pipeline exists, but no sink is registered and no provider SDK is installed, so no report leaves the device | `utils/monitoring.ts`, `package.json` |
| Does the app ask for OS permissions? | **One prompt, and only on iOS**: the Face ID consent alert, the first time a patient who opted in to biometric app-unlock returns to a locked app (D-15). Android's `USE_BIOMETRIC` raises no dialog. The manifests declare four things — see §1.1 | `app.json`, `features/auth/biometrics.ts`, `features/emergency/dial.ts` |

One library that can raise a runtime dialog is installed, and it is the
narrowest of them: `expo-local-authentication`, for biometric app-unlock
(D-15). It returns a yes or a no. It reads no biometric data, stores none, and
cannot: the template never leaves the phone's secure enclave, and this app
never sees it.

Every other one is absent — `expo-location`, `expo-notifications`,
`expo-camera`, `expo-image-picker`, `expo-contacts` — and the first two are
listed under *deliberately absent* in `docs/ARCHITECTURE.md`: nothing in v1
needs coordinates, and a notifications library would let the app request a
permission it cannot use while BE-12 has no provider.

### 1.1 What the manifests declare anyway — and why it is a review finding

"No runtime prompt" is not the same as "no permission in the manifest", and a
store reviewer reads the manifest. `app.json` declares three things:

| Declared | Why it is there | Is it used? |
|---|---|---|
| `android.permission.CALL_PHONE` | Emergency dialling | **No.** `features/emergency/dial.ts` opens `tel:`, which starts the dialler with the number entered and does **not** place the call — the patient presses the dialler's own button. That is `ACTION_DIAL`, which needs no permission at all. The file's own docblock says the permission is "declared but never used to auto-dial" |
| `NSFaceIDUsageDescription` | Biometric app-unlock | **Yes**, since D-15. `features/auth/biometrics.ts` invokes it, but only for a patient who turned the setting on — it is opt-in and off by default, so a patient who never opens Security never sees the alert |
| `android.permission.USE_BIOMETRIC` | The same feature on Android | **Yes**, on the same terms. It is a *normal* permission: it is listed on the Play listing and raises no dialog of its own |
| `LSApplicationQueriesSchemes` (`tel`, `maps`, `geo`, `comgooglemaps`) | Checking whether a dialler or a map app exists before offering the button | **Yes.** This is not a permission — it is the iOS allow-list for `canOpenURL`, and it grants no access to data |

**`CALL_PHONE` is still worth a decision before submission, and this document
does not make it.** A declared `CALL_PHONE` appears on the Play listing and
invites a question the app cannot answer with a feature, because `dial.ts`
opens `tel:` and never places a call. Removing it is a change to the emergency
feature's configuration, so it belongs to whoever owns that row — not to the
document that noticed. Recorded in §6 as an owner decision.

`NSFaceIDUsageDescription` is no longer part of that finding: D-15 landed and
the string now describes something the app does.

---

## 2. Apple — App Privacy

Apple asks, per data type: is it **collected**, is it **linked to the user**, is
it used for **tracking**, and for what **purposes**.

**Tracking is "No" for every row below**, and that answer is not a judgement
call: tracking in Apple's sense requires linking data with third-party data for
advertising or measurement, and this app has no third party.

| Data type | Collected | Linked | Purpose | Basis in the code |
|---|---|---|---|---|
| **Contact info — name** | Yes | Yes | App functionality | `registerFormSchema`: `firstName`, `lastName` |
| **Contact info — email address** | Yes | Yes | App functionality | Registration and sign-in |
| **Contact info — phone number** | Yes | Yes | App functionality | `registerFormSchema`: `phone` |
| **Health & fitness — health** | Yes | Yes | App functionality | The app reads the patient's own appointments and (when ADR-031 lands) records over `/me/*`. It **transmits none**: there is no screen in this tree that writes clinical data |
| **Identifiers — user ID** | Yes | Yes | App functionality | The account id in the access token |
| **Sensitive info** | See §6 | — | — | An open question, named rather than answered |
| Financial info | No | — | — | No billing (ADR-018 §2, `billing: false`) |
| Location | **No** | — | — | No location library; nothing requests coordinates |
| Contacts | No | — | — | Not read |
| User content — photos | No | — | — | P-04 is blocked on BE-15; no picker is installed |
| Search history | No | — | — | The doctor query is sent to the server for that request and stored nowhere |
| Browsing history | No | — | — | Not applicable |
| Diagnostics | **No** | — | — | The W-04 pipeline is built, but no sink and no provider — nothing is transmitted. Answer becomes **Yes** the day a sink is registered |
| Usage data | **No** | — | — | The W-05 catalogue is built, but no sink and no provider — nothing is transmitted. Answer becomes **Yes** the day a sink is registered |
| Purchases | No | — | — | No purchases |
| Biometrics | **No** | — | — | D-15 asks the OS a yes/no question. The template never leaves the phone's secure enclave and this app never receives it, so there is nothing collected, nothing linked and nothing to transmit |

**"Data Not Collected" is NOT the right answer for this app**, even though the
app stores almost nothing on the device. The forms ask about data transmitted
off the device, and an authenticated patient client transmits credentials and
receives a chart. Answering "not collected" because the phone forgets it would
be the inaccurate declaration this row warns about.

---

## 3. Google — Data safety

Google asks the same questions in different words, plus two the App Store does
not: whether data is **encrypted in transit**, and whether the user can
**request deletion**.

| Google data category | Collected | Shared | Ephemeral? | Required? |
|---|---|---|---|---|
| Personal info — Name | Yes | No | No | Required |
| Personal info — Email address | Yes | No | No | Required |
| Personal info — Phone number | Yes | No | No | Required |
| Personal info — User IDs | Yes | No | No | Required |
| Health and fitness — Health info | Yes | No | **Processed ephemerally on the device** | Required for the clinical screens |
| App activity | No | — | — | — |
| App info and performance | No | — | — | — |
| Device or other IDs | No | — | — | — |

**Encrypted in transit: yes**, and the app cannot be configured to do otherwise
in a release build — `configs/env.ts` validates `EXPO_PUBLIC_API_BASE_URL` as a
URL and the app is built against an `https` origin.

**One host, and three links.** `EXPO_PUBLIC_APP_STORE_URL` (W-06),
`EXPO_PUBLIC_TERMS_URL` and `EXPO_PUBLIC_PRIVACY_URL` (E-05) are URL-shaped
configuration and none of them is a second host: each is handed to the OS to
open in the store app or the browser, and nothing is requested from them by
this app. The two consent documents accept `https:` only — narrower than the
store link's allow-list, because a consent screen must not be able to hand
control to another app. `store-privacy.test.ts` fails if a fourth appears.

**"Processed ephemerally" is a claim this codebase can actually make**, and it
is the one worth reading carefully. Google's definition is data used in memory
and not written to persistent storage. In this app:

- the **access token** lives in `ApiClient` in memory and nowhere else;
- **PHI is never written to disk** — the query cache is memory-only, and
  `clearPhiCache` sweeps it on logout, on session loss and after the background
  timeout (T-08, T-11);
- the **only** thing written to durable storage is the refresh token, in the
  Keychain/Keystore (`storage/secure-store.ts`).

`src/test/security.test.ts` asserts each of those, which is why the claim is in
the declaration rather than in a hope.

**Deletion:** the app has **no in-app account deletion**, and will not have one:
PHI is never hard-deleted (DB §7). P-10 builds a *request to close the account*
over the seam and is 🟨 on BE-10; when it is live the answer to Google's
question becomes "deletion is requested in-app and actioned by the clinic",
which is a different answer from "no route" and from "deleted on request".
Google requires the form to say so and to give a route. See §6.

---

## 4. What the app stores on the device

| Value | Where | Survives a restart? |
|---|---|---|
| Refresh token | Keychain / Keystore, `WHEN_UNLOCKED_THIS_DEVICE_ONLY` | Yes |
| Access token | Memory (`ApiClient`) | No |
| Appointments, profile, notifications, records | Memory (the query cache) | No |
| Theme, locale, onboarding-seen | AsyncStorage, unencrypted (`preferenceStore`) | **Yes** — E-02, P-07 |
| **Anything else** | — | Nothing else is stored |

The one durable row is worth a sentence, because it is the only thing this app
writes to ordinary application storage rather than the keychain. It is three
values — a colour scheme, a language code, and a boolean saying the carousel has
been seen. None of them is PHI, none identifies a person, and the key vocabulary
is closed by construction: `durable-preference-store.ts` reads exactly the three
keys `PREFERENCE_KEYS` defines and nothing else can enter it. Neither
questionnaire has a category that a theme preference falls into, and this does
not change either answer in §2 or §3.

---

## 5. Third parties

**There are none.** The app has one network destination: the clinic's API, from
one environment variable. No analytics SDK, no crash reporter, no advertising
identifier, no attribution library, no tag manager, no font or asset CDN at
runtime — fonts are bundled.

This is the claim most likely to stop being true, which is why
`src/test/store-privacy.test.ts` fails the build if a dependency matching a
known analytics, advertising or crash-reporting name appears in
`package.json`. That test is the reminder that **this document has to change in
the same pull request**.

W-04 and W-05 have since landed as a *pipeline and a port* with no provider
behind either: `utils/monitoring.ts` and `utils/analytics.ts` build the payload
and hand it to registered sinks, and a production build registers none. So the
answers above are still "none collected", and the sentence that has to change
is this one — the day somebody implements a `CrashSink` or an `AnalyticsSink`
that transmits, both **Diagnostics** and **Usage data** become *Yes*.

---

## 6. What cannot be answered from the code — the owner's decisions

These four are the reason this document says DRAFT. Each needs a person, not a
grep.

1. **Is the health data "sensitive information" in Apple's sense?** Apple has a
   *Sensitive Info* category separate from *Health & Fitness*, and which one a
   clinical appointment history falls under is a policy reading, not a code
   fact.
2. **The privacy-policy URL.** Both stores require a reachable one. The
   registration form already requires the patient to accept a Privacy Policy
   (`acceptPrivacy` is `literal(true)` because `users.privacy_accepted_at` is
   NOT NULL), so a document exists as a legal artifact — this repository does
   not contain its URL.
3. **The deletion route.** Google requires either in-app deletion or a stated
   off-app route. P-10 is unbuilt, so today the answer is an off-app route —
   whichever address or process the clinic actually operates.
4. **Data retention.** A store form asks how long data is kept. That is the
   backend's and the clinic's answer, not this app's.
5. **The one unused manifest declaration** in §1.1 — `CALL_PHONE`. It is
   declared and no code in this tree exercises it. Keeping it is defensible (the
   emergency feature may want `ACTION_CALL` one day) and so is removing it, but
   shipping without deciding means a reviewer asks first.
   `NSFaceIDUsageDescription` left this list when D-15 landed.

**None of the four is a reason to delay the parts that are answerable**, which
is why the tables above are complete and these are listed separately.

---

## 7. When this document must be revisited

Any of these changes the declaration, and each is a row that is currently open:

| Change | Row | What it adds to the form |
|---|---|---|
| A crash **sink** that transmits | W-04 (pipeline built) | Diagnostics / *App info and performance*. PHI redaction is verified — `records-crash.test.tsx` — so the remaining question is only the processor agreement with whoever receives it |
| An analytics **sink** that transmits | W-05 (catalogue built) | Usage data / *App activity*. The catalogue carries no identifier and no free text, so the answer would be *not linked to identity* |
| Push notifications | **O-03**, BE-12 | A permission, a device token, and a third party |
| Profile photo upload | **P-04**, BE-15 | User content — photos, plus a camera or library permission |
| Health records, labs, prescriptions | **J-\***, ADR-031 | No new category — the *Health* row already covers it — but it widens what is read |
| A durable preference store (MMKV) | C-04 note | Moves three values out of "ephemeral" |
| Location, ever | Q-05, **AD-3** | A Location row, and a permission |
| A device passcode fallback on the biometric prompt | D-15 | Nothing on the form, but it would undo the control: the OS passcode unlocks a phone that is already unlocked. `biometrics.ts` sets `disableDeviceFallback` for that reason |

---

*Derived from the code. Sign-off is the project owner's; accuracy is this
document's.*
