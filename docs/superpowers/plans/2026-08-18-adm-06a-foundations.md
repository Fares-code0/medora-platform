# ADM-06 Foundations Implementation Plan

> **Historical implementation plan — not a task register** (labelled 2026-10-26). The work this plan describes has landed. Its checkboxes are the plan's steps as written and were never ticked, so they record nothing about what is done or open. Current status of ADM-06: [`frontend/FRONTEND_CHECKLIST.md`](../../../frontend/FRONTEND_CHECKLIST.md) §13.4.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make two things ADM-06 needs available without changing how anything behaves — move the conversation model into `shared-domain` so the admin area can read it, and extract the subject-agnostic half of ADM-10's PHI elevation gate so a second consumer can reuse it.

**Architecture:** Two independent refactors of working code. The conversation move takes `types.ts`, `mock-data.ts` and `store.ts` out of `features/doctor/messaging/model/` and into `features/shared-domain/conversations/`, leaving every selector, component and page behind. The PHI extraction lifts the grant lifecycle and reason validation into `features/shared-domain/audited-access/`, parameterised by capability, category type, TTL and minimum reason length, while `admin/phi`'s public surface stays byte-identical.

**Tech Stack:** TypeScript (strict) · Vitest + Testing Library · React 19 · Vite.

**Spec of record:** [`docs/superpowers/specs/2026-08-18-adm-06a-foundations-design.md`](../specs/2026-08-18-adm-06a-foundations-design.md)

## Global Constraints

Every task's requirements implicitly include this section.

- **The deliverable of this whole plan is "nothing behaves differently."** No new route, screen, capability or store. No user-visible change.
- **Working directory is `frontend/`.** Every path below is relative to the repository root; every command runs from `frontend/`.
- **`backend/` is off-limits.**
- **Do not touch `frontend/FRONTEND_CHECKLIST.md`.** The ADM-06 row stays ❌: this sub-project enables that row and does not deliver it, and marking it otherwise would overstate what shipped.
- **TypeScript strict** with `noUnusedLocals`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. No `any`, no non-null assertions. `readonly` on every domain field.
- **`features/shared-domain/` is the only feature-level import exception** (`FRONTEND_ARCHITECTURE.md` §3.3). ESLint's `import/no-restricted-paths` enforces the rest; a feature importing another feature is a lint error, not a style opinion.
- **`admin/phi/index.ts` must keep exporting exactly what it exports today**, with the same signatures: `MaskedIdentifier`, `PhiAccessProvider`, `usePhiAccess`, `categoryLabel`, `PHI_ELEVATION_MINUTES`, `PHI_JUSTIFICATION_CATEGORIES`, `PHI_REASON_MIN_LENGTH`, `validateReason`, `type PhiGrant`.
- **`phi-access.test.ts` and `PhiAccessProvider.test.tsx` must pass unedited.** Editing an assertion in either means behaviour moved — stop and report rather than adapting the test.
- **No consumer of `admin/phi` may need editing.** Eight-plus files import it. If one does, the extraction changed the interface and has gone wrong.
- Comments explain *why*, not what. A file-header block naming the module's responsibility, then comments only where a reader would ask "why is it done this way".
- **Quality gates before every commit**, from `frontend/`:
  ```bash
  npm run typecheck && npm run lint && npm run test
  ```
- **Commit after every task.** Conventional-commit subject, `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` last.

### Baseline to preserve

At the branch point: **41 test files, 532 tests, typecheck clean, lint 0 errors (20 pre-existing `react-refresh` warnings), build green.** Test *count* may rise as this plan adds characterization tests; no existing test may change or fail.

---

## File Structure

**Created**

| File | Responsibility |
| --- | --- |
| `frontend/src/features/shared-domain/conversations/types.ts` | `Contact`, `ChatMessage`, `Conversation`, `MessageAttachment`, `SharedLink` and their unions |
| `frontend/src/features/shared-domain/conversations/seed.ts` | `SEED_CONTACTS`, `SEED_CONVERSATIONS` (the file called `mock-data.ts` today) |
| `frontend/src/features/shared-domain/conversations/store.ts` | The `medora.messaging.v1` persistence boundary |
| `frontend/src/features/shared-domain/conversations/store.test.ts` | Characterization tests for the store |
| `frontend/src/features/shared-domain/conversations/seed.test.ts` | Seed invariants |
| `frontend/src/features/shared-domain/conversations/index.ts` | Barrel, matching `patient-identity/index.ts` |
| `frontend/src/features/shared-domain/audited-access/access-grant.ts` | `AccessGrant<C>`, `grantFor`, `isLive`, `pruneGrants`, `formatExpiry`, `validateReason` |
| `frontend/src/features/shared-domain/audited-access/index.ts` | Barrel |

**Modified**

| File | Change |
| --- | --- |
| `frontend/src/features/doctor/messaging/model/selectors.ts` | Import types and seed from `shared-domain/conversations` |
| `frontend/src/features/doctor/messaging/model/*` | `types.ts`, `mock-data.ts`, `store.ts` deleted after the move |
| `frontend/src/features/doctor/messaging/**` (8 files) | Re-point imports |
| `frontend/src/features/admin/phi/phi-access.ts` | Re-export from the shared module; keep PHI's constants and category set |
| `frontend/FRONTEND_ARCHITECTURE.md` | §3.3 gains two shared-domain entries |

**Deleted**

`frontend/src/features/doctor/messaging/model/types.ts`, `mock-data.ts`, `store.ts` — moved, not copied. A leftover copy is a second source of truth, which is the thing this plan exists to prevent.

---

### Task 1: Characterization tests, before anything moves

`find src -name "*.test.*"` matches nothing under `doctor/messaging`. So this refactor currently has **no evidence** that behaviour survives it — `tsc` proves imports resolve, not that a store still stores. These tests are written against the *current* code, pass against it, and must pass **unedited** after Task 2. That is what makes them evidence.

**Files:**
- Create: `frontend/src/features/doctor/messaging/model/store.test.ts`
- Create: `frontend/src/features/doctor/messaging/model/seed.test.ts`

**Interfaces:**
- Consumes: `readStoredConversations`, `writeStoredConversations`, `localId` from `./store`; `SEED_CONTACTS`, `SEED_CONVERSATIONS` from `./mock-data`; `Conversation` from `./types`.
- Produces: nothing. Task 2 moves these two files verbatim.

- [ ] **Step 1: Write the store characterization test**

Create `frontend/src/features/doctor/messaging/model/store.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';

import { SEED_CONVERSATIONS } from './mock-data';
import { localId, readStoredConversations, writeStoredConversations } from './store';

/**
 * Characterization tests for the messaging persistence boundary.
 *
 * Written before the module moves to `shared-domain`, against the code as it
 * stands, so that "nothing changed" is a claim with evidence behind it rather
 * than an assurance. They must pass unedited on the far side of the move; an
 * edit here would mean the behaviour moved with the file.
 */

const STORAGE_KEY = 'medora.messaging.v1';

beforeEach(() => {
  window.localStorage.clear();
});

describe('readStoredConversations', () => {
  it('seeds a cold store and writes the seed back', () => {
    const conversations = readStoredConversations();

    expect(conversations).toEqual(SEED_CONVERSATIONS);
    // The seed is persisted on first read, not merely returned — otherwise
    // every reload would re-seed over the user's own messages.
    expect(window.localStorage.getItem(STORAGE_KEY)).not.toBeNull();
  });

  it('returns what was written rather than the seed', () => {
    const [first] = SEED_CONVERSATIONS;
    // Throw rather than return: an early return would make this test pass
    // silently on an empty seed, which is the one case it must not survive.
    if (first === undefined) throw new Error('SEED_CONVERSATIONS is empty');
    const edited = [{ ...first, unreadCount: 99 }];

    writeStoredConversations(edited);

    expect(readStoredConversations()).toEqual(edited);
  });

  it('falls back to the seed on a malformed payload', () => {
    window.localStorage.setItem(STORAGE_KEY, '{"not":"an array"}');

    expect(readStoredConversations()).toEqual(SEED_CONVERSATIONS);
  });

  it('falls back to the seed when an entry is not a conversation', () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([{ id: 'x' }]));

    expect(readStoredConversations()).toEqual(SEED_CONVERSATIONS);
  });

  it('falls back to the seed on unparseable JSON', () => {
    window.localStorage.setItem(STORAGE_KEY, 'not json at all');

    expect(readStoredConversations()).toEqual(SEED_CONVERSATIONS);
  });
});

describe('localId', () => {
  it('carries the prefix and never repeats within a session', () => {
    const ids = [localId('msg'), localId('msg'), localId('msg')];

    for (const id of ids) expect(id.startsWith('msg-')).toBe(true);
    expect(new Set(ids).size).toBe(3);
  });
});
```

- [ ] **Step 2: Write the seed invariant test**

Create `frontend/src/features/doctor/messaging/model/seed.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { SEED_CONTACTS, SEED_CONVERSATIONS } from './mock-data';

/**
 * Invariants the seed has always held, pinned before it moves.
 *
 * These outlive this refactor: ADM-06's admin table renders participants by
 * id, so a conversation naming a contact that does not exist would render a
 * blank participant rather than fail loudly.
 */

describe('the conversation seed', () => {
  it('is not empty', () => {
    expect(SEED_CONVERSATIONS.length).toBeGreaterThan(0);
    expect(SEED_CONTACTS.length).toBeGreaterThan(0);
  });

  it('resolves every participant to a known contact', () => {
    const contactIds = new Set(SEED_CONTACTS.map((contact) => contact.id));

    for (const conversation of SEED_CONVERSATIONS) {
      expect(conversation.participantIds.length).toBeGreaterThan(0);
      for (const participantId of conversation.participantIds) {
        expect(contactIds.has(participantId)).toBe(true);
      }
    }
  });

  it('gives every conversation at least one message', () => {
    for (const conversation of SEED_CONVERSATIONS) {
      expect(conversation.messages.length).toBeGreaterThan(0);
    }
  });

  it('uses unique conversation ids', () => {
    const ids = SEED_CONVERSATIONS.map((conversation) => conversation.id);

    expect(new Set(ids).size).toBe(ids.length);
  });
});
```

- [ ] **Step 3: Run both and verify they pass against the current code**

```bash
npm run test -- src/features/doctor/messaging/model
```

Expected: PASS. These describe code that already exists, so a failure here is a real pre-existing bug — report it rather than adjusting the test to match.

- [ ] **Step 4: Prove each test can fail**

A characterization test that cannot fail proves nothing, and proving *no change* is this plan's entire deliverable. Apply each mutation, confirm the named test fails, restore:

| Mutation in `store.ts` | Test that must fail |
| --- | --- |
| `readStoredConversations` returns `SEED_CONVERSATIONS` unconditionally | "returns what was written rather than the seed" |
| Delete the `writeStoredConversations(SEED_CONVERSATIONS)` call in the cold-store branch | "seeds a cold store and writes the seed back" |
| `isConversation` returns `true` unconditionally | "falls back to the seed when an entry is not a conversation" |
| `localId` returns `` `${prefix}-fixed` `` | "carries the prefix and never repeats within a session" |

In `mock-data.ts`, point one conversation's `participantIds` at `['nobody']` and confirm "resolves every participant to a known contact" fails.

After each, `git checkout -- <file>` and re-run. Confirm `git status --porcelain` shows only your two new test files before committing.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/doctor/messaging/model/store.test.ts frontend/src/features/doctor/messaging/model/seed.test.ts
git commit -m "test(adm-06a): characterize the messaging store before moving it"
```

---

### Task 2: Move the conversation model to `shared-domain`

**Files:**
- Create: `frontend/src/features/shared-domain/conversations/{types.ts,seed.ts,store.ts,index.ts}`
- Move: the two test files from Task 1 into the same directory
- Delete: `frontend/src/features/doctor/messaging/model/{types.ts,mock-data.ts,store.ts}`
- Modify: every file under `frontend/src/features/doctor/messaging/` that imported them

**Interfaces:**
- Produces: `frontend/src/features/shared-domain/conversations/index.ts` re-exporting `SEED_CONTACTS`, `SEED_CONVERSATIONS`, `localId`, `readStoredConversations`, `writeStoredConversations`, and the types `Contact`, `ContactRole`, `Presence`, `ChatMessage`, `MessageKind`, `MessageStatus`, `MessageAttachment`, `AttachmentKind`, `Conversation`, `SharedLink`.
- **Not produced:** `MessagingFolder`. A folder is a property of the doctor's inbox, not of a conversation — it stays in `model/selectors.ts` (move the type there if it currently lives in `types.ts`).

- [ ] **Step 1: Create the directory and move the three files**

```bash
mkdir -p frontend/src/features/shared-domain/conversations
git mv frontend/src/features/doctor/messaging/model/types.ts frontend/src/features/shared-domain/conversations/types.ts
git mv frontend/src/features/doctor/messaging/model/mock-data.ts frontend/src/features/shared-domain/conversations/seed.ts
git mv frontend/src/features/doctor/messaging/model/store.ts frontend/src/features/shared-domain/conversations/store.ts
git mv frontend/src/features/doctor/messaging/model/store.test.ts frontend/src/features/shared-domain/conversations/store.test.ts
git mv frontend/src/features/doctor/messaging/model/seed.test.ts frontend/src/features/shared-domain/conversations/seed.test.ts
```

`git mv` rather than create-and-delete so the history follows the code.

- [ ] **Step 2: Fix the moved files' own imports and headers**

In `store.ts`, `import { SEED_CONVERSATIONS } from './mock-data'` becomes `from './seed'`. In both test files, the same. Update each file's header comment: `types.ts` currently says "feature-local types (FRONTEND_ARCHITECTURE §9.1)" — that is now false; §9.1 lists `Conversation` as a *cross-feature* model, which is why it moved. Say that.

Move `MessagingFolder` out of `types.ts` into `model/selectors.ts` — it is declared at `types.ts:70` today, and a folder is a property of the doctor's inbox rather than of a conversation.

- [ ] **Step 3: Write the barrel**

Create `frontend/src/features/shared-domain/conversations/index.ts`, matching the shape of `frontend/src/features/shared-domain/patient-identity/index.ts` (read it first):

```ts
/**
 * Conversations — the shared messaging domain.
 *
 * Lives here rather than in `features/doctor/messaging` because two features
 * read it: the doctor's inbox and the admin's communication monitoring
 * (UX §3.6). `FRONTEND_ARCHITECTURE.md` §9.1 lists `Conversation` among the
 * cross-feature models, and §3.3 makes `shared-domain/` the only place a
 * feature may import from another.
 *
 * The persisted store moves with the model deliberately: if the admin read
 * the seed while the doctor read their own mutations, a message sent in the
 * inbox would be missing from the admin's table.
 */
export { SEED_CONTACTS, SEED_CONVERSATIONS } from './seed';
export { localId, readStoredConversations, writeStoredConversations } from './store';
export type {
  AttachmentKind,
  ChatMessage,
  Contact,
  ContactRole,
  Conversation,
  MessageAttachment,
  MessageKind,
  MessageStatus,
  Presence,
  SharedLink,
} from './types';
```

- [ ] **Step 4: Re-point every consumer**

Find them:

```bash
grep -rn "model/types\|model/mock-data\|model/store\|from '\./types'\|from '\./mock-data'\|from '\./store'" frontend/src/features/doctor/messaging
```

Each becomes `from '@/features/shared-domain/conversations'`. The eight known consumers are `components/ChatWorkspace.tsx`, `components/ConversationDetailsDrawer.tsx`, `components/ConversationListPane.tsx`, `components/FolderRail.tsx`, `components/MessageBubble.tsx`, `components/NewMessageDialog.tsx`, `mock/mock-messaging-service.ts`, `pages/MessagesPage.tsx`, plus `model/selectors.ts`. Verify the list rather than trusting it.

- [ ] **Step 5: Run the gates**

```bash
npm run typecheck && npm run lint && npm run test
```

Expected: PASS, with the Task 1 tests green **and unedited**. If either test file needed a change beyond its import path, behaviour moved with the file — stop and report.

Confirm nothing outside the doctor feature still points at the old path, and no feature imports another:

```bash
grep -rn "doctor/messaging/model" frontend/src
grep -rn "features/doctor" frontend/src/features/admin
```

Both expected empty.

- [ ] **Step 6: Verify in the browser — this is the check the missing tests would have made**

Start the dev server with `preview_start` using the `medora-dev` entry in `.claude/launch.json`. If port 5173 is held by another session, add an entry on a free port with `runtimeArgs: ["--prefix", "frontend", "run", "dev", "--", "--port", "<port>"]` — Vite hardcodes 5173 in `vite.config.ts`, so `autoPort` alone will not move it.

Sign in as `doctor@medora.health` / `Medora123!`, open `/doctor/messages`, then:

1. Confirm the conversation list renders with contacts named.
2. Send a message in a thread; confirm it appears.
3. Star and archive a thread; confirm the folder counts change.
4. **Reload the page** and confirm all three survived — that is the store working through its new home.
5. `read_console_messages` clean.

`tsc` cannot make this check and there is no test suite that does.

- [ ] **Step 7: Commit**

```bash
git add -A frontend/src
git commit -m "refactor(adm-06a): move the conversation model into shared-domain"
```

---

### Task 3: Extract the audited-access gate

**Files:**
- Create: `frontend/src/features/shared-domain/audited-access/{access-grant.ts,index.ts}`
- Modify: `frontend/src/features/admin/phi/phi-access.ts`

**Interfaces:**
- Produces:
  - `AccessGrant<C extends string>` — `{ subjectId, subjectLabel, category: C, reason, grantedAt, expiresAt }`, all `readonly`
  - `grantFor<C extends string>(subjectId: string, subjectLabel: string, category: C, reason: string, now: number, minutes: number): AccessGrant<C>`
  - `isLive(grant: AccessGrant<string>, now: number): boolean`
  - `pruneGrants<C extends string>(grants: readonly AccessGrant<C>[], now: number): readonly AccessGrant<C>[]`
  - `formatExpiry(grant: AccessGrant<string>): string`
  - `validateReason(reason: string, minLength: number): ReasonValidation`
  - `ReasonValidation` — `{ readonly ok: boolean; readonly message?: string }`
- Consumed by: `admin/phi/phi-access.ts` in this task, and `admin/communications` in sub-project B.

- [ ] **Step 1: Write `access-grant.ts`**

```ts
/**
 * An audited, expiring, justified grant — the mechanism behind every gated
 * reveal in the admin area.
 *
 * Extracted from ADM-10's PHI gate so ADM-06's content access reuses it
 * rather than reimplementing it: two implementations of the thing that
 * protects patient privacy means a hardening fix can reach one and miss the
 * other.
 *
 * Nothing here knows what is being revealed. The category type, the window
 * and the minimum reason length are all the consumer's to choose, because
 * they are policy — and policy belongs where the policy is decided.
 */

/** One live elevation, scoped to a single record. */
export interface AccessGrant<C extends string> {
  readonly subjectId: string;
  readonly subjectLabel: string;
  readonly category: C;
  readonly reason: string;
  readonly grantedAt: number;
  readonly expiresAt: number;
}

export function grantFor<C extends string>(
  subjectId: string,
  subjectLabel: string,
  category: C,
  reason: string,
  now: number,
  minutes: number,
): AccessGrant<C> {
  return {
    subjectId,
    subjectLabel,
    category,
    reason: reason.trim(),
    grantedAt: now,
    expiresAt: now + minutes * 60_000,
  };
}

export function isLive(grant: AccessGrant<string>, now: number): boolean {
  return grant.expiresAt > now;
}

/**
 * Drops expired grants. Returns the same array when nothing expired, so a
 * caller can skip a re-render.
 */
export function pruneGrants<C extends string>(
  grants: readonly AccessGrant<C>[],
  now: number,
): readonly AccessGrant<C>[] {
  const live = grants.filter((grant) => isLive(grant, now));
  return live.length === grants.length ? grants : live;
}

export interface ReasonValidation {
  readonly ok: boolean;
  readonly message?: string;
}

export function validateReason(reason: string, minLength: number): ReasonValidation {
  const trimmed = reason.trim();
  if (trimmed.length === 0) return { ok: false, message: 'A written reason is required.' };
  if (trimmed.length < minLength) {
    return {
      ok: false,
      message: `Give at least ${String(minLength)} characters — this is read by whoever audits the access.`,
    };
  }
  return { ok: true };
}

/** `14:32` — when a live grant re-masks itself. */
export function formatExpiry(grant: AccessGrant<string>): string {
  return new Date(grant.expiresAt).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}
```

The message strings are copied **verbatim** from `phi-access.ts`. `PhiAccessProvider.test.tsx` asserts on user-visible copy; a reworded message is a behaviour change.

- [ ] **Step 2: Write the barrel**

Create `frontend/src/features/shared-domain/audited-access/index.ts`:

```ts
/**
 * Audited access — the shared elevation gate (ADM-10, and ADM-06 next).
 */
export {
  formatExpiry,
  grantFor,
  isLive,
  pruneGrants,
  validateReason,
  type AccessGrant,
  type ReasonValidation,
} from './access-grant';
```

- [ ] **Step 3: Rewrite `phi-access.ts` over the shared module**

Keep everything PHI-specific — `PhiJustificationCategory`, `PhiCategoryMeta`, `PHI_JUSTIFICATION_CATEGORIES`, `categoryLabel`, `PHI_ELEVATION_MINUTES = 15`, `PHI_REASON_MIN_LENGTH = 12` — exactly as they are. Replace the moved implementations with PHI-shaped bindings:

```ts
import {
  formatExpiry,
  grantFor as grantForAccess,
  isLive,
  pruneGrants,
  validateReason as validateAccessReason,
  type AccessGrant,
  type ReasonValidation,
} from '@/features/shared-domain/audited-access';

/**
 * PHI's grant is the shared grant narrowed to PHI's own category union, so a
 * grant carrying a category PHI does not recognise stays a type error.
 */
export type PhiGrant = AccessGrant<PhiJustificationCategory>;

/**
 * PHI's policy, applied. The window and the minimum reason length are PHI's
 * choices and stay declared here; the shared module takes them as arguments
 * precisely so a second consumer can choose differently.
 */
export function grantFor(
  subjectId: string,
  subjectLabel: string,
  category: PhiJustificationCategory,
  reason: string,
  now: number,
  minutes: number = PHI_ELEVATION_MINUTES,
): PhiGrant {
  return grantForAccess(subjectId, subjectLabel, category, reason, now, minutes);
}

export function validateReason(reason: string): ReasonValidation {
  return validateAccessReason(reason, PHI_REASON_MIN_LENGTH);
}

export { formatExpiry, isLive, pruneGrants, type ReasonValidation };
```

The `grantFor` default and the one-argument `validateReason` are what keep the public surface identical — `JustificationDialog.tsx` calls `validateReason(reason)` with one argument and must keep working untouched.

- [ ] **Step 4: Run the PHI suites first, unedited**

```bash
npm run test -- src/features/admin/phi
```

Expected: PASS, all 413 lines' worth, with **no edit to either file**. If an assertion fails, behaviour moved — stop and report rather than adjusting the test.

- [ ] **Step 5: Confirm no consumer needed changing**

```bash
git status --porcelain
```

Expected: only `phi-access.ts` modified plus the two new shared files. **Any other file appearing here means the extraction changed the interface** — that is the stop signal named in the spec, not something to patch by editing the consumer.

- [ ] **Step 6: Run the gates and commit**

```bash
npm run typecheck && npm run lint && npm run test
git add frontend/src
git commit -m "refactor(adm-06a): extract the audited-access gate from ADM-10"
```

---

### Task 4: Documentation and final gates

**Files:**
- Modify: `frontend/FRONTEND_ARCHITECTURE.md` §3.3

- [ ] **Step 1: Add the two modules to §3.3**

§3.3 lists the shared-domain modules; `patient-identity/` is the only one that exists. Add the two this plan created, in the same one-line register:

```
├── conversations/      # Conversation/ChatMessage/Contact model, seed, and the
│                       #   medora.messaging.v1 store — read by the doctor inbox (2.7)
│                       #   and admin communication monitoring (3.6)
├── audited-access/     # Expiring, justified, categorised access grants — the gate
│                       #   behind ADM-10 PHI reveals and ADM-06 content access
```

Leave the entries §3.3 lists as *intended but unbuilt* (`appointment-core/`, `scheduling/`, `audit/`) alone — they are still unbuilt, and `audited-access/` is not the `audit/` that entry describes.

- [ ] **Step 2: Final gates**

```bash
npm run typecheck && npm run lint && npm run test && npm run build
```

Expected: all four pass. Test count is the baseline **plus** Task 1's new tests; no existing test changed.

- [ ] **Step 3: Commit**

```bash
git add frontend/FRONTEND_ARCHITECTURE.md
git commit -m "docs(adm-06a): record the two new shared-domain modules"
```

---

## Notes for the implementer

**The success claim is "nothing changed", so the interesting evidence is negative.** Three things prove it, and each is easy to skip:

1. **Task 1's tests pass unedited after Task 2.** If a test needed changing beyond its import path, the move changed behaviour. That is a stop-and-report.
2. **Both PHI suites pass unedited after Task 3.** Same rule. These are the 413 lines guarding the admin area's privacy gate.
3. **`git status` after Task 3 shows no consumer edits.** `admin/phi`'s public surface is the contract; eight-plus files depend on it.

**Where this can go wrong quietly:**

- **A leftover copy.** `git mv`, not copy-then-delete. Two copies of the conversation seed is precisely the divergence this refactor exists to remove, and nothing would fail.
- **Widening `PhiGrant`'s category to `string`.** It would compile and the tests would pass, and PHI would silently accept a category it does not recognise. `AccessGrant<PhiJustificationCategory>` is the point of the generic.
- **Reworded validation copy.** `PhiAccessProvider.test.tsx` asserts on user-visible strings; copy the messages verbatim.

**Observed, deliberately not fixed:** `validateReason` also exists independently in `admin/appointments/oversight.ts`, `admin/doctors/doctors.ts`, and `admin/patients/patients.ts` (`REASON_MIN_LENGTH = 12` at `patients.ts:39`, `validateReason` at `patients.ts:80`), each with its own `REASON_MIN_LENGTH = 12`. Four near-identical implementations counting PHI's is worth consolidating onto the shared one — but that is unrelated refactoring of three modules this spec does not otherwise touch, and the spec's non-goals rule it out. Worth a follow-up row.
