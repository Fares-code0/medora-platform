# ADM-06 Sub-project A — Foundations

**Date:** 2026-08-18
**Checklist row:** ADM-06 · `frontend/FRONTEND_CHECKLIST.md` §4 (enabling work; the row itself closes in sub-project B)
**Spec of record:** `frontend/UX_ARCHITECTURE.md` §3.6, `frontend/FRONTEND_ARCHITECTURE.md` §3.3 and §9.1

---

## 1. Purpose

ADM-06 needs two things that do not exist yet, and both are refactors of working
code rather than new features. Doing them under the pressure of also building a
three-tab screen is how a tested, safety-critical module gets quietly broken, so
they are their own sub-project with their own gate.

**This whole spec has one success claim: nothing behaves differently afterwards.**
No new screen, no new route, no new capability, no user-visible change at all.

## 2. Refactor 1 — the conversation model moves to `shared-domain`

### 2.1 Why

`features/admin/communications/` will need conversation data, and
`FRONTEND_ARCHITECTURE.md` §1.2 forbids one feature importing another — enforced
by ESLint's `import/no-restricted-paths`, not just convention. §3.3 names
`features/shared-domain/` as "the *only* feature-level import exception", and
§9.1 already lists **`Conversation`** among the cross-feature domain models. The
model is simply still sitting inside the doctor feature.

### 2.2 What moves, and what does not

Created: `frontend/src/features/shared-domain/conversations/`, following the
shape of its only sibling, `patient-identity/` (`types.ts`, data, `index.ts`).

| File | Verdict | Reason |
| --- | --- | --- |
| `model/types.ts` | **moves** | `Contact`, `ChatMessage`, `Conversation`, `MessageAttachment`, `SharedLink` and their unions are the cross-feature models §9.1 names |
| `model/mock-data.ts` | **moves** | `SEED_CONTACTS` and `SEED_CONVERSATIONS` are the seed both roles must agree on |
| `model/store.ts` | **moves** | See §2.3 — this is the decision that makes the refactor worth doing |
| `model/selectors.ts` | **stays** | Folder membership, previews, unread counts, drafts: doctor-inbox concerns, not conversation facts |
| `components/`, `pages/`, `api/`, `mock/` | **stay** | The doctor's messaging workspace |

`MessagingFolder` stays with the selectors — a folder is a property of the
doctor's inbox, not of a conversation.

### 2.3 The store moves, and that is the point

`store.ts` is three functions — `localId`, `readStoredConversations`,
`writeStoredConversations` — over `localStorage` key `medora.messaging.v1`. It is
where a message the doctor sends actually persists.

If only the *seed* moved and the store stayed, the admin would read seeded
conversations while the doctor read mutated ones: a message sent in the inbox
would be missing from the admin's metadata table, and a conversation the doctor
archived would still look active. That is precisely the two-sources-of-truth
failure this project has now rejected twice, and it would be invisible until
someone compared two screens.

So the shared module owns the persisted conversation document. The doctor
feature keeps every read *of* it and every UI concern *around* it.

### 2.4 The real risk: there are no messaging tests

`find src -name "*.test.*"` matches nothing under `doctor/messaging`. So unlike
Refactor 2, this move has **no existing test proving behaviour is unchanged**,
and `tsc` only proves the imports still resolve — not that a selector still
selects.

Mitigation, and it is not optional: **write characterization tests before
moving anything.** They must be written against the *current* code, pass against
it, and then pass unchanged after the move — that is what makes them evidence
rather than decoration. Minimum coverage:

- `readStoredConversations()` returns the seed on a cold store, returns what
  `writeStoredConversations()` wrote, and falls back to the seed on a malformed
  payload (the file claims all three).
- `localId(prefix)` returns unique, prefixed ids across successive calls.
- The seed's own invariants: every `participantIds` entry resolves to a
  `SEED_CONTACTS` id, and every conversation has at least one message.

A characterization test that would pass against a broken implementation is worth
nothing here, since proving *no change* is the entire deliverable — so each must
be checked by mutation before the move begins.

## 3. Refactor 2 — the elevation gate becomes shared

### 3.1 Why

§3.6's content-access gate is structurally what ADM-10 already built for PHI:
capability + justification category + free-text reason + audit write, granted for
a window. Building a second one means two implementations of the mechanism that
protects patient privacy, and a hardening fix applied to one silently missing the
other.

### 3.2 What is generic and what is PHI's

Created: `frontend/src/features/shared-domain/audited-access/`.

**Moves (subject-agnostic):** the grant record and its lifecycle — `grantFor`,
`isLive`, `pruneGrants`, `formatExpiry` — and `validateReason` with its minimum
length. None of these mention PHI; they are about *an* audited, expiring,
justified grant.

**Stays in `admin/phi/` (PHI's own policy):** `PHI_JUSTIFICATION_CATEGORIES` and
its five clinical categories, the `patients.revealIdentity` capability the
provider gates on, `PHI_ELEVATION_MINUTES = 15` as PHI's chosen value,
`MaskedIdentifier`, and the `phiAccessLog` write.

The shared module is **parameterised**, not hardcoded. Concretely:

- **The grant is generic in its category:** `AccessGrant<C extends string>`
  carries `category: C`, so `admin/phi` uses
  `AccessGrant<PhiJustificationCategory>` and keeps full type safety rather than
  widening to `string`. A grant whose category is not in the consumer's own union
  stays a type error.
- **TTL and minimum reason length are arguments, not constants.** `grantFor`
  takes the window in minutes and `validateReason` takes the minimum length.
  `PHI_ELEVATION_MINUTES = 15` and `PHI_REASON_MIN_LENGTH = 12` stay in
  `admin/phi` as PHI's chosen values and are passed in — so PHI's policy stays
  visible where PHI's policy is decided, and ADM-06 can pick different values
  without touching it.

ADM-06 will pass `communications.viewContent`, §3.6's four categories, and its
own window.

### 3.3 The public surface of `admin/phi/` does not change

Eight or more files import from `admin/phi` — the appointments drawer, the
doctor profile tabs, the overview feeds, `logs.ts`, `administration.queries`.
**None of them may need editing.** `phi/index.ts` keeps exporting exactly what it
exports today; the extraction happens behind it. If a consumer needs a change,
the extraction has changed the interface and has gone wrong.

### 3.4 The guard

`phi-access.test.ts` (107 lines) and `PhiAccessProvider.test.tsx` (306 lines)
must pass **unchanged** — not adapted, not re-pointed. Editing an assertion in
either is the signal that behaviour moved, and is a stop-and-report, not a fix.

## 4. Non-goals

No new route, screen, capability, or store. No change to what any user sees. The
three tabs, the gated viewer, the safety-flag workflow, the ADM-07 log event and
the ADM-01 queue row are all sub-project B.

Naming: the shared module is `audited-access`, not the `audit/` that §3.3 lists
as intended — that entry describes a `useAuditedAction` hook wrapping the audit
dispatcher, which is a different thing and still unbuilt.

## 5. Verification

The deliverable is "nothing changed", so verification is mostly about what must
*not* move:

1. `phi-access.test.ts` and `PhiAccessProvider.test.tsx` pass **unedited**.
2. The characterization tests from §2.4 pass unedited before and after the move.
3. The full suite stays green and `npm run build` succeeds.
4. `grep -rn "doctor/messaging/model" frontend/src` returns nothing outside the
   doctor feature, and no file under `features/admin/` imports
   `features/doctor/` — the ESLint zone rule proves the second automatically.
5. A browser pass over the doctor inbox: open `/doctor/messages`, send a
   message, star and archive a thread, reload, and confirm the state persisted.
   This is the check `tsc` cannot make and the one the missing test suite would
   otherwise have made.

## 6. Tests

- `frontend/src/features/shared-domain/conversations/store.test.ts` — the
  characterization tests of §2.4, moved with the code they describe.
- `frontend/src/features/shared-domain/conversations/seed.test.ts` — the seed
  invariants, which also become the guard for sub-project B, since the admin
  table will render participants by id.
- No new tests for `audited-access`: its behaviour is already specified by the
  two PHI suites, and duplicating them would create a second place to update.
  Sub-project B adds the tests for the second consumer when there is one.

## 7. Documentation

`FRONTEND_ARCHITECTURE.md` §3.3 lists the shared-domain modules; add
`conversations/` and `audited-access/` with a line each. The checklist's ADM-06
row stays ❌ — this sub-project enables it and does not deliver it, and marking
it otherwise would overstate what shipped.
