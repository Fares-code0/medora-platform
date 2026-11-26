# Clinical and legal sign-off — Medora Patient App

**Checklist row:** W-10 (P0) · **Depends on:** N-07, K-03, J-06 · **Decisions:** AD-4, AD-5
**Status:** ⛔ **NOT SIGNED.** No item below carries a name.

> **No build ships to a store on this document as it stands.** W-10 is a release
> gate, and a gate whose state is "nobody has looked" is closed, not open.

---

## 0. Why this file exists, and why it existed before it existed

`src/features/emergency/content/guidance.ts` has told its reader, since the
Emergency phase landed, that a step-by-step treatment instruction must be taken
*"to the clinical owner named in `docs/SIGNOFF.md`"* — and `docs/SIGNOFF.md` was
not there. W-10 named it in its Files column and nothing wrote it. A pointer to
a register that does not exist is worse than no pointer: it reads as though a
process is in place.

So this is the register. It does two things and deliberately not a third:

1. It names **what needs signing**, with the exact files each signature covers,
   so a reviewer is not asked to approve "the emergency copy" in the abstract.
2. It records **what the code does while nothing is signed** — and
   `src/test/signoff.test.ts` fails the build when the code stops doing it.
3. It does **not** sign anything. Nobody here has the standing to, and a
   register that can be satisfied by the person who wrote it is a formality.

The third point is the reason this row stays ⬜ rather than moving to 🟨 on the
strength of a document. The engineering half of W-10 is a gate somebody can
actually open; the row is the signature.

---

## 1. The register

| # | Item | Signed by | Role | Date |
|---|---|---|---|---|
| 1 | Emergency copy | ⛔ not signed | Clinical owner | — |
| 2 | AI disclaimers | ⛔ not signed | Clinical owner | — |
| 3 | Results-release policy | ⛔ not signed | Clinical owner + legal | — |

**Signing is editing this table.** `signoff.test.ts` reads the *Signed by*
column: `⛔ not signed` holds the corresponding constraint in §2 as a build
gate, and any other value releases it. That is the whole mechanism — there is
no flag elsewhere, no environment variable, and nothing to redeploy.

Replacing `⛔ not signed` with a name is a claim that the named person read the
artefacts listed in §2 for that item and accepts them. It is not a way to get a
test to pass.

---

## 2. What each signature covers, and what holds until it is given

### 1 — Emergency copy · N-01, N-02, N-03, N-07, N-09

**Artefacts**

- `src/features/emergency/content/guidance.ts` — the bundled red flags, the
  non-dismissible disclaimer, and the "when to call vs when to book" guidance.
- `src/features/emergency/components/EmergencyDisclaimer.tsx` — N-02's
  persistent framing.
- `src/features/emergency/components/EmergencyCallButton.tsx` — N-03's two-step
  activation before any dial.
- The emergency and clinical blocks of `src/i18n/messages/en.ts` and
  `src/i18n/messages/ar.ts` — since 2026-11-23 the words themselves live
  there (`emergency.*`, `crash.*`, `support.urgent.*`, `upgrade.emergency`,
  `messages.urgencyNotice`, and the clinical vocabulary
  `health.allergy.severity.*`, `health.medication.status.*`,
  `health.history.kind.*`, `health.labs.flag.*`,
  `health.prescriptions.status.*`), and `guidance.ts` holds only their keys.

**Arabic — translation approved, clinical review outstanding (2026-11-23)**

The owner approved localizing all application-controlled copy into Arabic on
2026-11-23, this item's copy included. That approval covers **translating
only**. The Arabic of every key above is an **engineering draft awaiting the
named clinical reviewer**: it has not been read by a clinician or by a native
speaker, and nothing in this register records a signature for it. Signing this
item means the signatory has read the English **and** the Arabic side by side
and accepts that the Arabic preserves the clinical meaning exactly — including
that no emergency instruction was weakened or altered. `signoff.test.ts` holds
the no-treatment-instruction constraint against the catalogue values in both
languages until then. Operator-configured emergency number labels and
`whenToUse` lines are operator data, rendered as configured and never
translated by the app; they are outside this item.

**Questions on the English source, for the clinical reviewer** (raised by the
independent Arabic review, 2026-11-23; the Arabic mirrors the English
faithfully in both, so these are not translation defects and the English was
not changed):

1. `emergency.call.confirmDetail` — "Only continue if you need emergency help
   now" is shown for **every** confirmed call, including the clinic's own line
   and the patient's emergency contacts, where "emergency help" may not apply.
   Should those two calls carry different wording?
2. `emergency.unconfigured.body` — the claim that the local emergency number
   "is usually on the back of your phone's SIM card" needs confirming as
   factually accurate for the deployment regions, or removing.

**What holds until it is signed**

> The bundled emergency content contains **no treatment instruction**.

The copy is confined to *recognition and navigation* — "these signs mean call
now", "Medora is not an emergency service", "do not wait for a reply here". No
compression depth, no dose, no tourniquet technique, no positioning advice, no
airway manoeuvre. `guidance.ts` states this at the top of the file; the test
enforces it against a deny-list, so a plausible-looking first-aid step written
by a developer cannot reach a patient in a crisis by way of a pull request
nobody read closely.

**This is why N-07 is ⬜ and not in progress.** N-07 asks for static first-aid
guidance, *clinically reviewed and attributed*. Writing the content is the easy
half and the wrong half to do first: the review and the attribution are what
make it safe, and they are this signature. When item 1 is signed, N-07 becomes
ordinary work.

### 2 — AI disclaimers · K-03, K-04, AD-4

> **Re-opened on 2026-09-14 under §4.** This section used to read *"Artefacts —
> none yet"* and the constraint it held was *"this app has no AI surface at
> all"*. An AI surface now exists, which is the exact trigger §4 names: **item 2
> stops being an absence and becomes an artefact list.** It is **still not
> signed**, and the constraint below is what replaced the absence — not a
> relaxation of it.

**Artefacts**

- `src/features/ai/components/AiDisclaimer.tsx` — K-03's persistent,
  non-dismissible framing. The one sentence that is on every assistant screen at
  all times.
- `src/features/ai/components/AiSafetyCard.tsx` — the longer framing: not a
  doctor, can be wrong, a person should decide, and the unconditional route to
  Emergency that stands in for K-04's classifier.
- `src/features/ai/components/AiUnavailableNotice.tsx` — what a patient is told
  instead, on every assistant screen.
- `src/features/ai/components/AiEscalationCard.tsx` — how the server's
  red-flag safety message is shown, with the route to Emergency.
- The `ai.*` block of `src/i18n/messages/en.ts` and `ar.ts` — all of the above,
  in both languages. **The Arabic has not been read by a native speaker** and
  `messages/ar.ts` says so at the top; that caveat is inside this signature.

**What holds until it is signed**

> **No AI-generated, scripted or simulated text reaches a patient, and no
> assistant surface accepts clinical input.**

The absence that used to hold here was the absence of a *screen*. What holds now
is the absence of the thing the screen was dangerous for. Specifically, and each
one is a test rather than a promise:

- No assistant is connected, and the constant that says so is not a flag
  anybody can flip into a working assistant — there is nothing behind it
  (`features/ai/availability.ts`).
- `features/ai/` contains no network call, no `@/api/` import, no `service.ts`,
  no persistence, and no client-side red-flag classifier
  (`features/ai/ai.test.tsx`).
- No string long enough to read as a scripted reply is stored anywhere in the
  directory. An `assistant`-authored message exists only inside a test file.
- The composer is not editable, and says why on the screen rather than only in
  an accessibility hint.
- Every assistant screen renders the non-dismissible disclaimer **and** the
  "no assistant is connected" notice (`features/ai/ai.test.tsx`,
  asserted by `it.each` so a fifth screen without one fails).

AD-4 — whether a patient-facing assistant ships at all — remains the owner's
decision and has not been made. **This signature is now reachable rather than
premature**: there is a specific, listed set of sentences for a clinical owner
to read, which is what §0 says a register is for. What it does not cover, and
cannot until AD-4 is decided, is any generated output — that is a new artefact
list and a new signature, not this one.

### 3 — Results-release policy · J-06, J-08, AD-5, ADR-031

**Artefacts**

- `src/types/vocabularies.ts` — the `RELEASE_STATES` client vocabulary.
- `src/features/health/screens/TestsScreen.tsx` — test status only; results are
  not shown and the screen says they are shared by the care team once released.
- `docs/PUBLIC_PROJECTIONS.md` — what a patient may see.

**What holds until it is signed**

> A record's release state is **read, never derived**, and `released` is never
> the client's default.

Whether a patient may see an unreviewed `critical-high` lab result before a
clinician has reviewed it is a clinical policy decision (AD-5), recorded as
**ADR-031 — Results Release Policy**, which is *proposed*, not accepted. Until
it is, the client's job is to render whatever state it is given honestly —
including "pending clinician review", which is a state and not a blank — and
never to decide that a value is safe to show.

---

## 3. What signing does not cover

| Not covered here | Where it belongs |
|---|---|
| Store privacy declarations, the privacy-policy URL, the retention period | `docs/STORE_PRIVACY.md` §6 — a different owner and a different set of questions |
| The accessibility audit's owner signature | `docs/A11Y_AUDIT.md` §7 — S-09, which carries its own |
| Whether the Emergency affordance is translated into Arabic | Decided: the owner approved the translation on 2026-11-23 (`docs/A11Y_AUDIT.md` §6). The **clinical review of the Arabic wording** is inside this document's item 1, and it is not signed |
| Release signing and provisioning | W-03. A *cryptographic* signature, unrelated to this file despite the word |

---

## 4. When this document must be revisited

| Change | Effect |
|---|---|
| Any edit to `features/emergency/content/` | Item 1 is re-opened — a signature covers what was read |
| Any edit to an emergency or clinical catalogue key (§2 item 1), in either language | Item 1 is re-opened — a signature covers what was read |
| An AI surface of any kind | Item 2 stops being an absence and becomes an artefact list — **this happened on 2026-09-14** |
| Any edit to `features/ai/` copy or to the `ai.*` catalogue block | Item 2 is re-opened — a signature covers what was read |
| An assistant that generates output | A **new** row. Item 2 covers the framing, never the generated text |
| ADR-031 accepted | Item 3 gains a policy to sign against, and J-06/J-08 unblock |
| A new P0 screen carrying clinical copy | A fourth row, or a named reason it falls under an existing one |

---

*Three items, none signed. The constraints in §2 are what stands in their place,
and `src/test/signoff.test.ts` is what makes them stand.*
