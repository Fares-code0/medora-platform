# ADM-06 Communication Monitoring Implementation Plan

> **Historical implementation plan — not a task register** (labelled 2026-10-26). The work this plan describes has landed. Its checkboxes are the plan's steps as written and were never ticked, so they record nothing about what is done or open. Current status of ADM-06: [`frontend/FRONTEND_CHECKLIST.md`](../../../frontend/FRONTEND_CHECKLIST.md) §13.4.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `/admin/communications` — three tabs over one derived document, a capability-gated watermarked reader, and a safety-flag queue whose flags are derived rather than stored — closing the ADM-06 checklist row.

**Architecture:** One query returns `{ rows, overview, flags }`, all derived in a single pass from the shared `medora.messaging.v1` conversation store plus an admin-local overlay store. Flags have no natural id, so they get a deterministic one from `conversationId + messageId + category`; status transitions write an overlay keyed by that id and the flag itself is never persisted. Content access instantiates sub-project A's `audited-access` under this feature's own category union and policy numbers.

**Tech Stack:** TypeScript (strict) · React 19 · TanStack Query · Vitest + Testing Library · Vite · Tailwind design tokens.

**Spec of record:** [`docs/superpowers/specs/2026-08-18-adm-06b-communications-design.md`](../specs/2026-08-18-adm-06b-communications-design.md) · `frontend/UX_ARCHITECTURE.md` §3.6

## Global Constraints

Every task's requirements implicitly include this section.

- **Working directory is `frontend/`.** Every path below is relative to the repository root; every command runs from `frontend/`.
- **`backend/` is off-limits.**
- **The two policy numbers are named constants, declared once, never inline.** `COMMS_REASON_MIN_LENGTH = 20` and `COMMS_ACCESS_MINUTES = 10`, both in `communications.ts`. Implementation, tests and on-screen copy all read those constants — a test that hardcodes `20` passes against a broken constant.
- **The shared `medora.messaging.v1` store is READ-ONLY from this feature.** The admin area never writes a message, marks one read, or archives a thread. Every mutation goes to `medora.admin.communications.v1`.
- **No message content on the Overview tab** — not in a tooltip, not in a chart label, not in an empty state.
- **Patient identifiers render through `MaskedIdentifier`** (ADM-10). The doctor is named; the patient is masked.
- **Fail closed.** Any uncertainty about a grant — malformed overlay, unparseable store, a conversation id resolving to nothing — denies access rather than defaulting open.
- **The three capabilities gate three different things:** `communications.viewMetadata` the section, `communications.viewContent` the request-access affordance and the viewer route, `communications.resolveFlags` the resolve actions.
- **TypeScript strict** with `noUnusedLocals`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. No `any`, no non-null assertions. `readonly` on every domain field. Under `noUncheckedIndexedAccess`, indexing an array yields `T | undefined` — destructure and throw, never assert.
- **No new dependencies.** Charts come from `@/components/charts`; the project has no third-party charting library and none is to be added.
- Comments explain *why*, not what. A file-header block naming the module's responsibility, then comments only where a reader would ask "why is it done this way".
- **Quality gates before every commit**, from `frontend/`:
  ```bash
  npm run typecheck && npm run lint && npm run test
  ```
  Expect lint: 0 errors, 20 pre-existing `react-refresh` warnings. `npm run format:check` is KNOWN-RED on 565 pre-existing files (CRLF vs `endOfLine: lf`) — do not run it, do not try to fix it.
- **Commit after every task.** Conventional-commit subject, `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` last.

### Baseline to preserve

At the branch point (`542fb5b`): **44 test files, 552 tests, typecheck clean, lint 0 errors, build green.** Test count rises; **no existing test may change or fail.** The doctor's messaging suites and the PHI suites are downstream of the shared modules this feature reads — neither should need editing. If one does, this feature has reached into something it should not have.

---

## File Structure

**Created**

| File | Responsibility |
| --- | --- |
| `frontend/src/features/admin/communications/communications.types.ts` | Domain types — `ConversationRow`, `CommunicationsOverview`, `SafetyFlag`, `FlagOverlay`, `ContentAccessEntry` and their unions |
| `frontend/src/features/admin/communications/communications.ts` | Policy constants, the typed `audited-access` wrapper, and every pure derivation |
| `frontend/src/features/admin/communications/communications.test.ts` | Aggregates, filter, sort, the typed wrapper |
| `frontend/src/features/admin/communications/flag-rules.ts` | The four detectors and the deterministic flag id |
| `frontend/src/features/admin/communications/flag-rules.test.ts` | Each detector, positive **and** negative; id determinism |
| `frontend/src/features/admin/communications/communications.api.ts` | Mock service, the overlay store, the append-only access log |
| `frontend/src/features/admin/communications/communications.api.test.ts` | Append-only surface, one event per gated read, ref equality |
| `frontend/src/features/admin/communications/communications.queries.ts` | Query keys and hooks |
| `frontend/src/features/admin/communications/CommunicationsSection.tsx` | Three-tab shell |
| `frontend/src/features/admin/communications/CommunicationsSection.test.tsx` | The three capability gates |
| `frontend/src/features/admin/communications/OverviewTab.tsx` | Aggregate analytics |
| `frontend/src/features/admin/communications/ConversationLogsTab.tsx` | Metadata table + request-access affordance |
| `frontend/src/features/admin/communications/SafetyFlagsTab.tsx` | Flag queue |
| `frontend/src/features/admin/communications/ContentAccessProvider.tsx` | Holds the live grant; the gate's React seam |
| `frontend/src/features/admin/communications/ContentAccessDialog.tsx` | Justification modal |
| `frontend/src/features/admin/communications/ConversationViewerPage.tsx` | The gated reader route |
| `frontend/src/features/admin/communications/WatermarkOverlay.tsx` | Diagonal watermark |
| `frontend/src/features/admin/communications/FlagResolveDialog.tsx` | Dismiss / warn / escalate, each with a reason |

**Modified**

| File | Change |
| --- | --- |
| `frontend/src/features/shared-domain/conversations/seed.ts` | Three flaggable messages added (Task 3) |
| `frontend/src/routes/index.ts` | `communications` added to `AdminSectionSlug` |
| `frontend/src/features/admin/administration.types.ts` | `AdminSectionSlug` union member, if declared here rather than in routes |
| `frontend/src/features/admin/administration.meta.ts` | `SECTION_META.communications` entry |
| `frontend/src/features/admin/routes.tsx` | Section route + the viewer child route |
| `frontend/src/layouts/navigation.ts` | `adminNavigation` entry |
| `frontend/src/features/admin/logs/logs.types.ts` | `communication-content-accessed` event type |
| `frontend/src/features/admin/logs/logs.ts` | Its `TYPE_CATEGORY` mapping, `ALL_EVENT_TYPES` entry and label |
| `frontend/src/features/admin/overview/overview.types.ts` | Fifth queue row + `SecurityAlertKind` member |
| `frontend/src/features/admin/overview/overview.ts` | Deriving both |
| `frontend/FRONTEND_CHECKLIST.md` | ADM-06 row → ✅ (Task 13 only) |

---

### Task 1: Types, policy constants, and the typed access wrapper

The two policy numbers and the `audited-access` binding come first because every later task reads them. Sub-project A's module header is explicit that a consumer should bind the generic in its own typed wrapper rather than calling `grantFor` directly — `grantFor` takes four consecutive string parameters and transposing two still type-checks, inferring `C = string`.

**Files:**
- Create: `frontend/src/features/admin/communications/communications.types.ts`
- Create: `frontend/src/features/admin/communications/communications.ts`
- Create: `frontend/src/features/admin/communications/communications.test.ts`

**Interfaces:**
- Consumes: `AccessGrant`, `grantFor`, `isLive`, `pruneGrants`, `formatExpiry`, `validateReason`, `ReasonValidation` from `@/features/shared-domain/audited-access`.
- Produces: `COMMS_REASON_MIN_LENGTH`, `COMMS_ACCESS_MINUTES`, `CONTENT_ACCESS_CATEGORIES`, `categoryLabel`, `grantForConversation`, `validateAccessReason`, `type ContentGrant`; and from the types file every domain type later tasks name.

- [ ] **Step 1: Write `communications.types.ts`**

```ts
/**
 * Communication monitoring domain types (ADM-06 · UX §3.6).
 *
 * Two things here are deliberately absent. There is no `SafetyFlag.body` —
 * only `excerpt`, the matched message and nothing around it, because §3.6
 * says minimum necessary context and a queue is not a reader. And no type
 * here carries a patient's name in a field the table renders directly; the
 * row carries it only to hand to `MaskedIdentifier`.
 */

import type { NamedSeries } from '@/components/charts';

/* ── Safety flags ─────────────────────────────────────────────── */

export type FlagCategory =
  | 'emergency-language'
  | 'harassment'
  | 'phi-wrong-channel'
  | 'prescription-solicitation';

export type FlagSource = 'auto' | 'user';

export type FlagStatus = 'open' | 'under-review' | 'resolved';

export type FlagResolution = 'dismissed' | 'warned' | 'escalated';

/**
 * A flag is derived, never stored. Its id is a deterministic function of
 * the message and category it came from — see `flagId` in `flag-rules.ts`.
 */
export interface SafetyFlag {
  readonly id: string;
  readonly conversationId: string;
  readonly messageId: string;
  readonly category: FlagCategory;
  readonly source: FlagSource;
  /** The matched message only. Never the surrounding thread. */
  readonly excerpt: string;
  /** "Dr. Omar Khalil" or "Patient" — never a patient's name. */
  readonly authorLabel: string;
  readonly at: string;
  readonly status: FlagStatus;
  readonly resolution: FlagResolution | null;
  readonly note: string | null;
  readonly decidedBy: string | null;
  readonly decidedAt: string | null;
}

/** The persisted half: everything a reviewer decided about a derived flag. */
export interface FlagOverlay {
  readonly flagId: string;
  readonly status: FlagStatus;
  readonly resolution: FlagResolution | null;
  readonly note: string | null;
  readonly decidedBy: string;
  readonly decidedAt: string;
}

/* ── Conversation metadata ────────────────────────────────────── */

export type ConversationStatus = 'active' | 'unanswered' | 'archived';

export interface ConversationRow {
  readonly id: string;
  readonly doctorName: string;
  /** Null for threads with no patient participant (doctor-to-doctor). */
  readonly patientId: string | null;
  /** Handed to `MaskedIdentifier`, never rendered directly. */
  readonly patientName: string | null;
  readonly participantCount: number;
  readonly startedAt: string;
  readonly lastActivityAt: string;
  readonly messageCount: number;
  readonly status: ConversationStatus;
  readonly flagCount: number;
}

export interface ConversationFilters {
  /** Matches doctor name, topic and conversation id — never a patient name. */
  readonly query: string;
  readonly status: ConversationStatus | 'all';
  readonly flagged: 'all' | 'flagged' | 'unflagged';
}

export type ConversationSort = 'recent' | 'oldest' | 'most-messages' | 'most-flags';

/* ── Overview aggregates ──────────────────────────────────────── */

export interface CommunicationsOverview {
  /** Messages per day across the trailing window. */
  readonly volume: NamedSeries;
  /** Null when no patient message has yet received a reply. */
  readonly medianResponseMinutes: number | null;
  readonly unansweredOver48h: number;
  readonly activeConversations: number;
  /** 0–1. Conversation-level: one thread with three flags counts once. */
  readonly flagRate: number;
}

/* ── Content access ───────────────────────────────────────────── */

export type ContentAccessCategory =
  | 'patient-complaint'
  | 'safety-flag'
  | 'legal-request'
  | 'quality-audit';

/**
 * One gated read. `id` is the "ref #" rendered in the viewer banner AND the
 * id of the log event written in `/admin/logs` — one identifier, not two.
 */
export interface ContentAccessEntry {
  readonly id: string;
  readonly conversationId: string;
  readonly category: ContentAccessCategory;
  readonly reason: string;
  readonly actor: string;
  readonly openedAt: string;
  readonly closedAt: string | null;
  readonly outcome: 'completed' | 'incomplete' | null;
}

/** The whole screen, in one object. */
export interface CommunicationsDocument {
  readonly rows: readonly ConversationRow[];
  readonly overview: CommunicationsOverview;
  readonly flags: readonly SafetyFlag[];
  readonly accessLog: readonly ContentAccessEntry[];
}
```

- [ ] **Step 2: Write the failing test for the policy constants and wrapper**

Create `frontend/src/features/admin/communications/communications.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  categoryLabel,
  COMMS_ACCESS_MINUTES,
  COMMS_REASON_MIN_LENGTH,
  CONTENT_ACCESS_CATEGORIES,
  grantForConversation,
  validateAccessReason,
} from './communications';

/**
 * The two policy numbers are asserted against the exported constants rather
 * than against literals. A test that hardcodes 20 passes against a constant
 * someone changed to 8 — it would only be testing itself.
 */

describe('content-access policy', () => {
  it('demands a longer reason than PHI does', () => {
    // PHI's floor is 12. Reading a whole thread is more invasive than
    // revealing one identifier, so this floor is higher.
    expect(COMMS_REASON_MIN_LENGTH).toBeGreaterThan(12);
  });

  it('rejects a reason one character short of the floor', () => {
    const reason = 'a'.repeat(COMMS_REASON_MIN_LENGTH - 1);

    expect(validateAccessReason(reason).ok).toBe(false);
  });

  it('accepts a reason exactly at the floor', () => {
    const reason = 'a'.repeat(COMMS_REASON_MIN_LENGTH);

    expect(validateAccessReason(reason).ok).toBe(true);
  });

  it('does not count surrounding whitespace toward the floor', () => {
    const core = 'a'.repeat(COMMS_REASON_MIN_LENGTH - 1);

    expect(validateAccessReason(`  ${core}  `).ok).toBe(false);
  });

  it('expires a grant COMMS_ACCESS_MINUTES after it was issued', () => {
    const now = 1_700_000_000_000;

    const grant = grantForConversation(
      'cv-referral',
      'Conversation cv-referral',
      'quality-audit',
      'Reviewing response times for the quarterly audit',
      now,
    );

    expect(grant.expiresAt).toBe(now + COMMS_ACCESS_MINUTES * 60_000);
    expect(grant.category).toBe('quality-audit');
  });

  it('names all four justification categories from §3.6', () => {
    const ids = CONTENT_ACCESS_CATEGORIES.map((entry) => entry.id);

    expect(ids).toEqual([
      'patient-complaint',
      'safety-flag',
      'legal-request',
      'quality-audit',
    ]);
  });

  it('labels a category and falls back to its id', () => {
    expect(categoryLabel('legal-request')).toBe('Legal request');
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

```bash
npm run test -- src/features/admin/communications
```

Expected: FAIL — `Failed to resolve import "./communications"`.

- [ ] **Step 4: Write the constants and wrapper half of `communications.ts`**

```ts
/**
 * Communication monitoring — policy and pure derivations (ADM-06 · UX §3.6).
 *
 * The two policy numbers live here and nowhere else. `audited-access` takes
 * them as arguments precisely so a second consumer can choose differently
 * from PHI, and this is that second consumer.
 */

import {
  formatExpiry,
  grantFor,
  isLive,
  pruneGrants,
  validateReason,
  type AccessGrant,
  type ReasonValidation,
} from '@/features/shared-domain/audited-access';

import type { ContentAccessCategory } from './communications.types';

/**
 * Free-text reason floor. Higher than PHI's 12: reading an entire private
 * thread is more invasive than revealing one identifier, and warrants a
 * justification an auditor can actually evaluate.
 */
export const COMMS_REASON_MIN_LENGTH = 20;

/**
 * How long a content grant stays open. Shorter than PHI's 15: reading a
 * five-message thread does not need a quarter of an hour, and a shorter
 * window means fewer grants outlive the task that justified them.
 */
export const COMMS_ACCESS_MINUTES = 10;

export interface ContentAccessCategoryMeta {
  readonly id: ContentAccessCategory;
  readonly label: string;
  readonly description: string;
}

export const CONTENT_ACCESS_CATEGORIES: readonly ContentAccessCategoryMeta[] = [
  {
    id: 'patient-complaint',
    label: 'Patient complaint',
    description: 'A patient has raised a concern about this conversation.',
  },
  {
    id: 'safety-flag',
    label: 'Safety flag',
    description: 'Reviewing a flag raised automatically or by a participant.',
  },
  {
    id: 'legal-request',
    label: 'Legal request',
    description: 'Responding to a documented legal or regulatory request.',
  },
  {
    id: 'quality-audit',
    label: 'Quality audit',
    description: 'Sampling for a scheduled quality or compliance review.',
  },
];

export function categoryLabel(id: ContentAccessCategory): string {
  return CONTENT_ACCESS_CATEGORIES.find((entry) => entry.id === id)?.label ?? id;
}

/** This feature's grant, narrowed to its own category union. */
export type ContentGrant = AccessGrant<ContentAccessCategory>;

/**
 * The typed wrapper `audited-access` asks consumers to write. Binding `C`
 * here means a transposed argument at a call site is a type error rather
 * than a silent widening to `string`.
 */
export function grantForConversation(
  conversationId: string,
  conversationLabel: string,
  category: ContentAccessCategory,
  reason: string,
  now: number,
  minutes: number = COMMS_ACCESS_MINUTES,
): ContentGrant {
  return grantFor(conversationId, conversationLabel, category, reason, now, minutes);
}

export function validateAccessReason(reason: string): ReasonValidation {
  return validateReason(reason, COMMS_REASON_MIN_LENGTH);
}

export { formatExpiry, isLive, pruneGrants, type ReasonValidation };
```

- [ ] **Step 5: Run the test and watch it pass**

```bash
npm run test -- src/features/admin/communications
```

Expected: PASS, 7 tests.

- [ ] **Step 6: Prove the constants are load-bearing**

Change `COMMS_REASON_MIN_LENGTH` to `12` and confirm "demands a longer reason than PHI does" fails. Change `COMMS_ACCESS_MINUTES` to `15` and confirm the expiry test fails. Restore both with `git checkout --` and re-run.

If either test still passes under its mutation, the test is reading a literal somewhere instead of the constant — fix the test, not the constant.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/features/admin/communications
git commit -m "feat(adm-06b): content-access policy and the typed audited-access wrapper"
```

---

### Task 2: The flag detectors

These rules decide what an administrator reads. A detector that matches everything is as broken as one that matches nothing, and **only the negative fixtures catch the first kind** — which is why every detector here gets both.

**Files:**
- Create: `frontend/src/features/admin/communications/flag-rules.ts`
- Create: `frontend/src/features/admin/communications/flag-rules.test.ts`

**Interfaces:**
- Consumes: `hashString` from `@/features/shared-domain/patient-identity`; `ChatMessage` from `@/features/shared-domain/conversations`; `FlagCategory` from `./communications.types`.
- Produces: `flagId(conversationId, messageId, category): string`, `detectCategories(body: string): readonly FlagCategory[]`, `FLAG_CATEGORY_LABEL: Record<FlagCategory, string>`, `ALL_FLAG_CATEGORIES: readonly FlagCategory[]`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/features/admin/communications/flag-rules.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  ALL_FLAG_CATEGORIES,
  detectCategories,
  flagId,
  FLAG_CATEGORY_LABEL,
} from './flag-rules';

/**
 * Every detector is tested from both sides. A rule that fires on ordinary
 * clinical conversation is worse than one that never fires: it buries the
 * real flags and trains a reviewer to dismiss the queue unread.
 */

describe('emergency language', () => {
  it('fires on a patient describing acute symptoms', () => {
    expect(detectCategories('I have severe chest pain right now')).toContain(
      'emergency-language',
    );
  });

  it('does not fire on the same words in a routine clinical context', () => {
    expect(
      detectCategories('Your chest x-ray from last month came back clear.'),
    ).not.toContain('emergency-language');
  });
});

describe('prescription solicitation', () => {
  it('fires on a request to obtain a controlled drug without a prescription', () => {
    expect(
      detectCategories('Can you send tramadol without a prescription please'),
    ).toContain('prescription-solicitation');
  });

  it('does not fire on a legitimate refill discussion', () => {
    expect(
      detectCategories('Your atorvastatin refill is ready at the pharmacy.'),
    ).not.toContain('prescription-solicitation');
  });
});

describe('PHI in the wrong channel', () => {
  it('fires on a record identifier pasted into chat', () => {
    expect(detectCategories('the record is PT-1004, please check')).toContain(
      'phi-wrong-channel',
    );
  });

  it('does not fire on a message with no identifier', () => {
    expect(detectCategories('Please check the record before Friday.')).not.toContain(
      'phi-wrong-channel',
    );
  });
});

describe('harassment', () => {
  // No seeded instance exists — there is no inoffensive seed for this
  // category and the conversation seed is shared with the doctor's inbox.
  // The detector is therefore proven here, against fixtures, or nowhere.
  it('fires on abusive language directed at a participant', () => {
    expect(detectCategories('you are an idiot and I will make you regret this')).toContain(
      'harassment',
    );
  });

  it('does not fire on frustrated but civil disagreement', () => {
    expect(
      detectCategories('I am frustrated that this has taken three weeks.'),
    ).not.toContain('harassment');
  });
});

describe('detectCategories', () => {
  it('returns nothing for ordinary clinical conversation', () => {
    expect(detectCategories('Follow-up ordered. Thanks, Salma.')).toEqual([]);
  });

  it('can return more than one category for one message', () => {
    const found = detectCategories(
      'PT-1004 needs tramadol without a prescription, send it now',
    );

    expect(found).toContain('phi-wrong-channel');
    expect(found).toContain('prescription-solicitation');
  });

  it('returns categories in a stable order regardless of match order', () => {
    const found = detectCategories(
      'PT-1004 needs tramadol without a prescription, send it now',
    );

    // Ordered by ALL_FLAG_CATEGORIES, so a row's badges never reshuffle
    // between renders of the same message.
    const positions = found.map((category) => ALL_FLAG_CATEGORIES.indexOf(category));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});

describe('flagId', () => {
  it('is stable for the same message and category', () => {
    expect(flagId('cv-1', 'msg-1', 'harassment')).toBe(
      flagId('cv-1', 'msg-1', 'harassment'),
    );
  });

  it('differs across categories on the same message', () => {
    expect(flagId('cv-1', 'msg-1', 'harassment')).not.toBe(
      flagId('cv-1', 'msg-1', 'emergency-language'),
    );
  });

  it('differs across messages in the same conversation', () => {
    expect(flagId('cv-1', 'msg-1', 'harassment')).not.toBe(
      flagId('cv-1', 'msg-2', 'harassment'),
    );
  });
});

describe('FLAG_CATEGORY_LABEL', () => {
  it('labels every category', () => {
    for (const category of ALL_FLAG_CATEGORIES) {
      expect(FLAG_CATEGORY_LABEL[category].length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm run test -- src/features/admin/communications/flag-rules
```

Expected: FAIL — `Failed to resolve import "./flag-rules"`.

- [ ] **Step 3: Write `flag-rules.ts`**

```ts
/**
 * Safety-flag detection (ADM-06 · UX §3.6).
 *
 * Deterministic rules over message text. This is NOT a classifier and must
 * not be described as one in UI copy — it is a fixed set of patterns whose
 * behaviour a reviewer can read in one screen and predict exactly.
 *
 * Each rule carries negative patterns as well as positive ones, because the
 * expensive failure here is the false positive: a queue full of ordinary
 * clinical conversation teaches a reviewer to dismiss it unread, and the one
 * real flag goes with it.
 */

import { hashString } from '@/features/shared-domain/patient-identity';

import type { FlagCategory } from './communications.types';

/**
 * Written out independently rather than derived from `FLAG_CATEGORY_LABEL`'s
 * keys: deriving it would make any totality test self-referential, which is
 * the trap ADM-07 Task 1 shipped and had to fix.
 */
export const ALL_FLAG_CATEGORIES: readonly FlagCategory[] = [
  'emergency-language',
  'harassment',
  'phi-wrong-channel',
  'prescription-solicitation',
];

export const FLAG_CATEGORY_LABEL: Record<FlagCategory, string> = {
  'emergency-language': 'Emergency language',
  harassment: 'Harassment or abuse',
  'phi-wrong-channel': 'Identifier in chat',
  'prescription-solicitation': 'Prescription solicitation',
};

interface Rule {
  readonly category: FlagCategory;
  readonly positive: readonly RegExp[];
  /** Any match here suppresses the rule — the clinical reading of the words. */
  readonly negative: readonly RegExp[];
}

const RULES: readonly Rule[] = [
  {
    category: 'emergency-language',
    positive: [
      /\bchest pain\b/i,
      /\bcan(?:'|no)?t breathe\b/i,
      /\bbleeding heavily\b/i,
      /\bunconscious\b/i,
      /\boverdose\b/i,
    ],
    // The same words describing a past investigation or a resolved episode
    // are ordinary follow-up, not an emergency in progress.
    negative: [/\bx-?ray\b/i, /\bcame back\b/i, /\blast (?:month|week|year)\b/i],
  },
  {
    category: 'harassment',
    positive: [
      /\byou are an? (?:idiot|fool|liar)\b/i,
      /\bshut up\b/i,
      /\bregret this\b/i,
      /\bincompetent\b/i,
    ],
    negative: [],
  },
  {
    category: 'phi-wrong-channel',
    positive: [/\bPT-\d{4}\b/, /\bMRN[:\s-]?\d+/i, /\b\d{11,}\b/],
    negative: [],
  },
  {
    category: 'prescription-solicitation',
    positive: [
      /\bwithout a prescription\b/i,
      /\b(?:oxycodone|tramadol|diazepam|alprazolam|adderall)\b/i,
      /\brefill (?:it )?early\b/i,
    ],
    // A pharmacy notifying that a dispensed refill is ready is the opposite
    // of a solicitation.
    negative: [/\brefill is ready\b/i, /\bat the pharmacy\b/i],
  },
];

/** Categories this message trips, ordered by `ALL_FLAG_CATEGORIES`. */
export function detectCategories(body: string): readonly FlagCategory[] {
  const hits = RULES.filter(
    (rule) =>
      rule.positive.some((pattern) => pattern.test(body)) &&
      !rule.negative.some((pattern) => pattern.test(body)),
  ).map((rule) => rule.category);

  return ALL_FLAG_CATEGORIES.filter((category) => hits.includes(category));
}

/**
 * A derived flag has no natural id, so it gets a deterministic one. Status
 * overlays are keyed by this value: it must not change between renders, and
 * it must differ for two categories on one message.
 */
export function flagId(
  conversationId: string,
  messageId: string,
  category: FlagCategory,
): string {
  return `flag-${hashString(`${conversationId}|${messageId}|${category}`).toString(36)}`;
}
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
npm run test -- src/features/admin/communications/flag-rules
```

Expected: PASS, 14 tests.

- [ ] **Step 5: Prove each detector can fail**

Apply each mutation, confirm the named test fails, then `git checkout -- frontend/src/features/admin/communications/flag-rules.ts` and re-run:

| Mutation | Test that must fail |
| --- | --- |
| Drop the `negative` check from `detectCategories` (match on positives alone) | "does not fire on the same words in a routine clinical context" |
| Return `ALL_FLAG_CATEGORIES` unconditionally from `detectCategories` | "returns nothing for ordinary clinical conversation" |
| Drop `category` from `flagId`'s hashed string | "differs across categories on the same message" |
| Drop `messageId` from `flagId`'s hashed string | "differs across messages in the same conversation" |
| Return `hits` directly instead of re-ordering by `ALL_FLAG_CATEGORIES` | "returns categories in a stable order regardless of match order" |

Confirm `git status --porcelain` shows only your two new files before committing.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/admin/communications/flag-rules.ts frontend/src/features/admin/communications/flag-rules.test.ts
git commit -m "feat(adm-06b): safety-flag detectors with negative fixtures"
```

---

### Task 3: Seed the shared corpus with flaggable messages

The detectors exist; nothing in the seed trips them. Three messages go into the **shared** conversation seed, which means they also appear in the doctor's inbox at `/doctor/messages` — so they must read as realistic clinical traffic, not as test fixtures.

Harassment gets no seeded instance. There is no inoffensive seed for it, and Task 2's fixtures are where that detector is proven.

**Files:**
- Modify: `frontend/src/features/shared-domain/conversations/seed.ts`
- Create: `frontend/src/features/admin/communications/seed-coverage.test.ts`

**Interfaces:**
- Consumes: `SEED_CONVERSATIONS` from `@/features/shared-domain/conversations`; `detectCategories` from `./flag-rules`.
- Produces: seeded messages that `detectCategories` flags — three flags across three conversations.

- [ ] **Step 1: Read the seed and pick the three homes**

```bash
npm run test -- src/features/shared-domain/conversations
```

Confirm green first (5 tests), then read `seed.ts`. Add one message to each of three different conversations — spreading them means the flag queue exercises grouping rather than showing three rows of one thread.

- [ ] **Step 2: Add the three messages**

Each is an ordinary `ChatMessage` in an existing conversation's `messages` array, with an id following that conversation's existing convention, a `sentAt` consistent with its neighbours, and `status: 'read'`:

1. **Emergency language** — from the patient contact in a patient thread:
   `'I have severe chest pain right now and it is not going away.'`
2. **Prescription solicitation** — from a patient contact:
   `'Could you send tramadol without a prescription? The pain is bad.'`
3. **Identifier in chat** — from a doctor contact in a care-team thread:
   `'Cross-check against PT-1004 before the panel on Friday.'`

Update each conversation's `lastActivityAt` if the new message is the newest in that thread, so the seed stays internally consistent.

- [ ] **Step 3: Add the seed invariant that ties the two together**

This test asserts a relationship between the shared seed and the admin's rules, so **which side it lives on is a lint question, not a taste question.** `eslint.config.js` declares `target: './src/features/shared-domain', from: [… './src/features/admin' …]` — shared-domain must not depend on role features (§3.3), and a test file under `shared-domain/` is bound by that rule like any other. A dynamic `await import()` might slip past the rule; using that to cross a boundary the config exists to defend would be worse than the static import, not better.

So it goes on the admin side, where importing shared-domain is exactly what that module is for. Create `frontend/src/features/admin/communications/seed-coverage.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { SEED_CONVERSATIONS } from '@/features/shared-domain/conversations';

import { detectCategories } from './flag-rules';

/**
 * The seam between the shared corpus and this feature's rules.
 *
 * It lives here rather than beside the seed because shared-domain may not
 * import a role feature (FRONTEND_ARCHITECTURE §3.3, enforced by ESLint).
 * The direction that is legal is also the honest one: the rules depend on
 * the seed, not the seed on the rules.
 */

describe('the shared seed, seen through the flag rules', () => {
  it('trips exactly three of the four categories', () => {
    const found = new Set<string>();
    for (const conversation of SEED_CONVERSATIONS) {
      for (const message of conversation.messages) {
        for (const category of detectCategories(message.body)) found.add(category);
      }
    }

    // An exact set, not a subset. It fails when a seeded flag stops matching
    // AND when an unintended message starts matching — including harassment,
    // which must stay unseeded because there is no inoffensive seed for it
    // and this corpus is also the doctor's inbox.
    expect(found).toEqual(
      new Set(['emergency-language', 'phi-wrong-channel', 'prescription-solicitation']),
    );
  });
});
```

Do **not** edit `frontend/src/features/shared-domain/conversations/seed.test.ts`. Its existing invariants (participants resolve, every conversation has a message, ids unique) must keep passing unedited over the enlarged seed — that is what proves the seed change added data rather than altering shape.

- [ ] **Step 4: Run the shared-domain and doctor messaging suites**

```bash
npm run test -- src/features/shared-domain/conversations
npm run test
```

Expected: both green. The store characterization tests from sub-project A must pass unedited — they assert seeding and round-tripping, not message counts. **If either needed editing, stop and report**: it would mean the seed change altered behaviour rather than adding data.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/shared-domain/conversations frontend/src/features/admin/communications
git commit -m "feat(adm-06b): seed three flaggable messages into the shared corpus"
```

---

### Task 4: The pure derivations

Everything the three tabs render, computed in one place from one input. This is the task that makes the tabs incapable of disagreeing.

**Files:**
- Modify: `frontend/src/features/admin/communications/communications.ts` (append)
- Modify: `frontend/src/features/admin/communications/communications.test.ts` (append)

**Interfaces:**
- Consumes: `Conversation`, `Contact`, `ChatMessage`, `ME_ID` from `@/features/shared-domain/conversations`; `detectCategories`, `flagId` from `./flag-rules`.
- Produces:
  - `toConversationRows(conversations, contacts, flags, now): readonly ConversationRow[]`
  - `deriveFlags(conversations, contacts, overlays): readonly SafetyFlag[]`
  - `buildOverview(conversations, rows, flags, now): CommunicationsOverview`
  - `filterRows(rows, filters): readonly ConversationRow[]`
  - `sortRows(rows, sort): readonly ConversationRow[]`
  - `UNANSWERED_HOURS = 48`, `TREND_DAYS = 14`

- [ ] **Step 1: Write the failing aggregate tests**

Append to `frontend/src/features/admin/communications/communications.test.ts`:

```ts
import {
  buildOverview,
  deriveFlags,
  filterRows,
  sortRows,
  toConversationRows,
  TREND_DAYS,
  UNANSWERED_HOURS,
} from './communications';
import type { Contact, Conversation } from '@/features/shared-domain/conversations';

/* ── Fixtures with known answers ──────────────────────────────── */

const NOW = Date.parse('2026-08-18T12:00:00.000Z');
const HOUR = 3_600_000;

function at(hoursAgo: number): string {
  return new Date(NOW - hoursAgo * HOUR).toISOString();
}

const CONTACTS: readonly Contact[] = [
  {
    id: 'ct-doc',
    name: 'Dr. Omar Khalil',
    role: 'doctor',
    department: 'Cardiology',
    presence: 'online',
    lastActiveAt: at(1),
    favorite: false,
  },
  {
    id: 'ct-pat',
    name: 'Mona Adel',
    role: 'patient',
    department: 'Patient portal',
    presence: 'offline',
    lastActiveAt: at(50),
    favorite: false,
  },
];

function conversation(
  id: string,
  messages: readonly { id: string; authorId: string; body: string; hoursAgo: number }[],
  overrides: Partial<Conversation> = {},
): Conversation {
  const built = messages.map((message) => ({
    id: message.id,
    authorId: message.authorId,
    kind: 'text' as const,
    body: message.body,
    sentAt: at(message.hoursAgo),
    status: 'read' as const,
  }));
  const last = built[built.length - 1];
  if (last === undefined) throw new Error('a conversation needs a message');
  return {
    id,
    participantIds: ['ct-doc', 'ct-pat'],
    topic: null,
    messages: built,
    unreadCount: 0,
    pinned: false,
    starred: false,
    archived: false,
    muted: false,
    draft: '',
    lastActivityAt: last.sentAt,
    ...overrides,
  };
}

describe('toConversationRows', () => {
  it('names the doctor and carries the patient for masking, never inline', () => {
    const rows = toConversationRows(
      [conversation('cv-1', [{ id: 'm1', authorId: 'ct-pat', body: 'hello', hoursAgo: 2 }])],
      CONTACTS,
      [],
      NOW,
    );

    const [row] = rows;
    if (row === undefined) throw new Error('expected one row');
    expect(row.doctorName).toBe('Dr. Omar Khalil');
    expect(row.patientName).toBe('Mona Adel');
    expect(row.messageCount).toBe(1);
  });

  it('marks a thread unanswered when the newest message is the patient and older than the window', () => {
    const rows = toConversationRows(
      [
        conversation('cv-1', [
          { id: 'm1', authorId: 'ct-pat', body: 'hello', hoursAgo: UNANSWERED_HOURS + 1 },
        ]),
      ],
      CONTACTS,
      [],
      NOW,
    );

    const [row] = rows;
    if (row === undefined) throw new Error('expected one row');
    expect(row.status).toBe('unanswered');
  });

  it('does not mark it unanswered at exactly the boundary', () => {
    const rows = toConversationRows(
      [
        conversation('cv-1', [
          { id: 'm1', authorId: 'ct-pat', body: 'hello', hoursAgo: UNANSWERED_HOURS },
        ]),
      ],
      CONTACTS,
      [],
      NOW,
    );

    const [row] = rows;
    if (row === undefined) throw new Error('expected one row');
    expect(row.status).not.toBe('unanswered');
  });

  it('does not mark it unanswered when the doctor replied last', () => {
    const rows = toConversationRows(
      [
        conversation('cv-1', [
          { id: 'm1', authorId: 'ct-pat', body: 'hello', hoursAgo: 100 },
          { id: 'm2', authorId: ME_ID, body: 'replying', hoursAgo: 99 },
        ]),
      ],
      CONTACTS,
      [],
      NOW,
    );

    const [row] = rows;
    if (row === undefined) throw new Error('expected one row');
    expect(row.status).toBe('active');
  });
});

describe('buildOverview', () => {
  it('excludes unanswered patient messages from the median response time', () => {
    // One answered pair with a 2-hour gap, and one very old unanswered
    // message. Including the unanswered one would drag the median by its
    // age; the spec says it belongs to `unansweredOver48h` instead.
    const conversations = [
      conversation('cv-answered', [
        { id: 'm1', authorId: 'ct-pat', body: 'question', hoursAgo: 10 },
        { id: 'm2', authorId: ME_ID, body: 'answer', hoursAgo: 8 },
      ]),
      conversation('cv-silent', [
        { id: 'm3', authorId: 'ct-pat', body: 'question', hoursAgo: 400 },
      ]),
    ];
    const rows = toConversationRows(conversations, CONTACTS, [], NOW);

    const overview = buildOverview(conversations, rows, [], NOW);

    expect(overview.medianResponseMinutes).toBe(120);
    expect(overview.unansweredOver48h).toBe(1);
  });

  it('reports a null median when nothing has been answered', () => {
    const conversations = [
      conversation('cv-silent', [
        { id: 'm1', authorId: 'ct-pat', body: 'question', hoursAgo: 400 },
      ]),
    ];
    const rows = toConversationRows(conversations, CONTACTS, [], NOW);

    expect(buildOverview(conversations, rows, [], NOW).medianResponseMinutes).toBeNull();
  });

  it('counts flag rate per conversation, not per flag', () => {
    const conversations = [
      conversation('cv-1', [
        { id: 'm1', authorId: 'ct-pat', body: 'I have severe chest pain right now', hoursAgo: 2 },
        {
          id: 'm2',
          authorId: 'ct-pat',
          body: 'send tramadol without a prescription',
          hoursAgo: 1,
        },
      ]),
      conversation('cv-2', [{ id: 'm3', authorId: ME_ID, body: 'noted', hoursAgo: 1 }]),
    ];
    const flags = deriveFlags(conversations, CONTACTS, []);
    const rows = toConversationRows(conversations, CONTACTS, flags, NOW);

    // Two flags, but they are in ONE of two active conversations.
    expect(flags.length).toBe(2);
    expect(buildOverview(conversations, rows, flags, NOW).flagRate).toBeCloseTo(0.5);
  });

  it('builds a trend point for every day in the window', () => {
    const conversations = [
      conversation('cv-1', [{ id: 'm1', authorId: ME_ID, body: 'hi', hoursAgo: 2 }]),
    ];
    const rows = toConversationRows(conversations, CONTACTS, [], NOW);

    expect(buildOverview(conversations, rows, [], NOW).volume.points).toHaveLength(
      TREND_DAYS,
    );
  });
});

describe('deriveFlags', () => {
  it('carries only the matched message as the excerpt', () => {
    const conversations = [
      conversation('cv-1', [
        { id: 'm1', authorId: ME_ID, body: 'unrelated context above', hoursAgo: 3 },
        { id: 'm2', authorId: 'ct-pat', body: 'I have severe chest pain right now', hoursAgo: 2 },
        { id: 'm3', authorId: ME_ID, body: 'unrelated context below', hoursAgo: 1 },
      ]),
    ];

    const flags = deriveFlags(conversations, CONTACTS, []);

    const [flag] = flags;
    if (flag === undefined) throw new Error('expected one flag');
    expect(flag.excerpt).toBe('I have severe chest pain right now');
    expect(flag.excerpt).not.toContain('unrelated');
  });

  it('never puts a patient name in the author label', () => {
    const conversations = [
      conversation('cv-1', [
        { id: 'm1', authorId: 'ct-pat', body: 'I have severe chest pain right now', hoursAgo: 2 },
      ]),
    ];

    const flags = deriveFlags(conversations, CONTACTS, []);

    const [flag] = flags;
    if (flag === undefined) throw new Error('expected one flag');
    expect(flag.authorLabel).not.toContain('Mona');
  });

  it('applies a matching overlay and defaults to open without one', () => {
    const conversations = [
      conversation('cv-1', [
        { id: 'm1', authorId: 'ct-pat', body: 'I have severe chest pain right now', hoursAgo: 2 },
      ]),
    ];
    const [derived] = deriveFlags(conversations, CONTACTS, []);
    if (derived === undefined) throw new Error('expected one flag');
    expect(derived.status).toBe('open');

    const [resolved] = deriveFlags(conversations, CONTACTS, [
      {
        flagId: derived.id,
        status: 'resolved',
        resolution: 'dismissed',
        note: 'Patient contacted by phone.',
        decidedBy: 'Admin',
        decidedAt: at(1),
      },
    ]);
    if (resolved === undefined) throw new Error('expected one flag');
    expect(resolved.status).toBe('resolved');
    expect(resolved.resolution).toBe('dismissed');
  });

  it('drops an overlay whose flag no longer matches any rule', () => {
    const conversations = [
      conversation('cv-1', [{ id: 'm1', authorId: ME_ID, body: 'nothing here', hoursAgo: 2 }]),
    ];

    // An overlay for a flag that no longer exists produces no row: there is
    // no such thing as an open flag on a message that trips nothing.
    expect(
      deriveFlags(conversations, CONTACTS, [
        {
          flagId: 'flag-stale',
          status: 'open',
          resolution: null,
          note: null,
          decidedBy: 'Admin',
          decidedAt: at(1),
        },
      ]),
    ).toEqual([]);
  });
});

describe('filterRows and sortRows', () => {
  const rows = toConversationRows(
    [
      conversation('cv-a', [
        { id: 'm1', authorId: 'ct-pat', body: 'I have severe chest pain right now', hoursAgo: 2 },
      ]),
      conversation('cv-b', [{ id: 'm2', authorId: ME_ID, body: 'plain', hoursAgo: 30 }]),
    ],
    CONTACTS,
    deriveFlags(
      [
        conversation('cv-a', [
          {
            id: 'm1',
            authorId: 'ct-pat',
            body: 'I have severe chest pain right now',
            hoursAgo: 2,
          },
        ]),
      ],
      CONTACTS,
      [],
    ),
    NOW,
  );

  it('filters to flagged conversations only', () => {
    const filtered = filterRows(rows, { query: '', status: 'all', flagged: 'flagged' });

    expect(filtered.map((row) => row.id)).toEqual(['cv-a']);
  });

  it('matches the query against the doctor name but not the patient name', () => {
    expect(
      filterRows(rows, { query: 'Omar', status: 'all', flagged: 'all' }).length,
    ).toBeGreaterThan(0);
    // Searching a patient's name must not be a way to find their thread.
    expect(filterRows(rows, { query: 'Mona', status: 'all', flagged: 'all' })).toEqual([]);
  });

  it('sorts most-flags first', () => {
    expect(sortRows(rows, 'most-flags').map((row) => row.id)).toEqual(['cv-a', 'cv-b']);
  });
});
```

Add `ME_ID` to the file's imports from `@/features/shared-domain/conversations`.

- [ ] **Step 2: Run and watch it fail**

```bash
npm run test -- src/features/admin/communications/communications
```

Expected: FAIL — the six new exports do not exist.

- [ ] **Step 3: Implement the derivations**

Append to `frontend/src/features/admin/communications/communications.ts`. Implement in this order, each satisfying the tests above:

- `UNANSWERED_HOURS = 48` and `TREND_DAYS = 14` as exported constants.
- A private `participantsOf(conversation, contacts)` returning the resolved `Contact[]`, skipping `ME_ID` (it is the signed-in doctor sentinel and has no contact row — see the constant's own docstring).
- `toConversationRows` — `doctorName` from the first participant with `role === 'doctor'`, falling back to `'Care team'`; `patientId`/`patientName` from the first `role === 'patient'` participant, both `null` when there is none; `status` is `'archived'` when the conversation is, else `'unanswered'` when the newest message's author is **not** `ME_ID` and is a patient **and** its age is strictly greater than `UNANSWERED_HOURS`, else `'active'`; `flagCount` from the flags passed in.
- `deriveFlags` — for each conversation, each message, each category from `detectCategories(message.body)`, build a `SafetyFlag` with `flagId(...)`. `authorLabel` is the contact's name **only when their role is not `patient`**; a patient author yields `'Patient'`. Merge the overlay by `flagId`; with no overlay the flag is `open` with nulls. Overlays with no matching derived flag are discarded.
- `buildOverview` — the five figures, exactly as §7 of the spec defines them. The median: collect every patient message that has a later message from `ME_ID` in the same conversation, take the gap in minutes to that reply, sort, take the middle (mean of the two middles when even), and round. Return `null` for an empty set.
- `filterRows` — `query` matches `doctorName`, topic and `id`, case-insensitively; **never `patientName`**. `status` and `flagged` are exact filters.
- `sortRows` — `recent`/`oldest` by `lastActivityAt`, `most-messages` by `messageCount`, `most-flags` by `flagCount`, each descending except `oldest`. Sort a copy; never mutate the input.

- [ ] **Step 4: Run and watch it pass**

```bash
npm run test -- src/features/admin/communications/communications
```

Expected: PASS.

- [ ] **Step 5: Prove the subtle ones can fail**

| Mutation | Test that must fail |
| --- | --- |
| Include unanswered patient messages in the median (treat "no reply" as a gap to `now`) | "excludes unanswered patient messages from the median response time" |
| Change the unanswered comparison from `>` to `>=` | "does not mark it unanswered at exactly the boundary" |
| Count flags rather than flagged conversations in `flagRate` | "counts flag rate per conversation, not per flag" |
| Add `patientName` to `filterRows`'s query match | "matches the query against the doctor name but not the patient name" |
| Keep overlays with no matching derived flag | "drops an overlay whose flag no longer matches any rule" |
| Use the contact's name for a patient author in `deriveFlags` | "never puts a patient name in the author label" |

Restore after each and re-run.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/admin/communications
git commit -m "feat(adm-06b): derive rows, flags and the five aggregates in one pass"
```

---

### Task 5: The mock service and the append-only access log

**Files:**
- Create: `frontend/src/features/admin/communications/communications.api.ts`
- Create: `frontend/src/features/admin/communications/communications.api.test.ts`

**Interfaces:**
- Consumes: `readStoredConversations`, `SEED_CONTACTS` from `@/features/shared-domain/conversations`; every derivation from `./communications`.
- Produces: `communicationsApi` with exactly these keys — `list`, `openAccess`, `closeAccess`, `setFlagStatus`, `resolveFlag`. `CommunicationsDocument` re-exported. Input types `OpenAccessInput`, `CloseAccessInput`, `FlagStatusInput`, `ResolveFlagInput`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/features/admin/communications/communications.api.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';

import { communicationsApi } from './communications.api';

beforeEach(() => {
  window.localStorage.clear();
});

describe('the service surface', () => {
  it('exposes no verb that edits or deletes an access-log entry', () => {
    // Asserted as an exact key set, following ADM-07. The access log is the
    // record of who read private messages; a service that can rewrite it is
    // not an audit trail, and "we just won't call it" is not a guarantee.
    expect(Object.keys(communicationsApi).sort()).toEqual([
      'closeAccess',
      'list',
      'openAccess',
      'resolveFlag',
      'setFlagStatus',
    ]);
  });
});

describe('openAccess', () => {
  it('appends exactly one entry per gated read', async () => {
    const before = await communicationsApi.list();

    await communicationsApi.openAccess({
      conversationId: 'cv-referral',
      category: 'quality-audit',
      reason: 'Sampling response times for the quarterly review',
      actor: 'Dr. Amelia Chen',
    });
    const after = await communicationsApi.list();

    expect(after.accessLog.length).toBe(before.accessLog.length + 1);
  });

  it('returns the entry whose id is the banner reference', async () => {
    const entry = await communicationsApi.openAccess({
      conversationId: 'cv-referral',
      category: 'legal-request',
      reason: 'Documented request from the compliance team',
      actor: 'Dr. Amelia Chen',
    });

    const document = await communicationsApi.list();
    const logged = document.accessLog.find((row) => row.id === entry.id);

    expect(logged).toBeDefined();
    expect(logged?.outcome).toBeNull();
    expect(logged?.closedAt).toBeNull();
  });

  it('refuses a reason under the floor rather than trusting the dialog', async () => {
    await expect(
      communicationsApi.openAccess({
        conversationId: 'cv-referral',
        category: 'safety-flag',
        reason: 'too short',
        actor: 'Dr. Amelia Chen',
      }),
    ).rejects.toThrow();
  });
});

describe('closeAccess', () => {
  it('closes an open entry as completed', async () => {
    const entry = await communicationsApi.openAccess({
      conversationId: 'cv-referral',
      category: 'quality-audit',
      reason: 'Sampling response times for the quarterly review',
      actor: 'Dr. Amelia Chen',
    });

    await communicationsApi.closeAccess({ id: entry.id, outcome: 'completed' });
    const document = await communicationsApi.list();

    expect(document.accessLog.find((row) => row.id === entry.id)?.outcome).toBe(
      'completed',
    );
  });

  it('records an interrupted session as incomplete', async () => {
    const entry = await communicationsApi.openAccess({
      conversationId: 'cv-referral',
      category: 'quality-audit',
      reason: 'Sampling response times for the quarterly review',
      actor: 'Dr. Amelia Chen',
    });

    await communicationsApi.closeAccess({ id: entry.id, outcome: 'incomplete' });
    const document = await communicationsApi.list();

    expect(document.accessLog.find((row) => row.id === entry.id)?.outcome).toBe(
      'incomplete',
    );
  });
});

describe('resolveFlag', () => {
  it('records the decision, the reason and who made it', async () => {
    const before = await communicationsApi.list();
    const [flag] = before.flags;
    if (flag === undefined) throw new Error('the seed must produce at least one flag');

    const after = await communicationsApi.resolveFlag({
      flagId: flag.id,
      resolution: 'dismissed',
      note: 'Patient was contacted by phone the same day.',
      decidedBy: 'Dr. Amelia Chen',
    });

    const resolved = after.flags.find((row) => row.id === flag.id);
    expect(resolved?.status).toBe('resolved');
    expect(resolved?.resolution).toBe('dismissed');
    expect(resolved?.decidedBy).toBe('Dr. Amelia Chen');
  });

  it('refuses to resolve without a note', async () => {
    const before = await communicationsApi.list();
    const [flag] = before.flags;
    if (flag === undefined) throw new Error('the seed must produce at least one flag');

    await expect(
      communicationsApi.resolveFlag({
        flagId: flag.id,
        resolution: 'dismissed',
        note: '   ',
        decidedBy: 'Dr. Amelia Chen',
      }),
    ).rejects.toThrow();
  });
});

describe('the shared conversation store', () => {
  it('is never written by this service', async () => {
    const key = 'medora.messaging.v1';
    await communicationsApi.list();
    const snapshot = window.localStorage.getItem(key);

    await communicationsApi.openAccess({
      conversationId: 'cv-referral',
      category: 'quality-audit',
      reason: 'Sampling response times for the quarterly review',
      actor: 'Dr. Amelia Chen',
    });
    const [flag] = (await communicationsApi.list()).flags;
    if (flag === undefined) throw new Error('the seed must produce at least one flag');
    await communicationsApi.setFlagStatus({
      flagId: flag.id,
      status: 'under-review',
      decidedBy: 'Dr. Amelia Chen',
    });

    expect(window.localStorage.getItem(key)).toBe(snapshot);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
npm run test -- src/features/admin/communications/communications.api
```

Expected: FAIL — `Failed to resolve import "./communications.api"`.

- [ ] **Step 3: Implement the service**

Follow `patients.api.ts` for shape: a `LATENCY_MS = 260` `delay` helper, a module-level store read from and written to `localStorage` under `medora.admin.communications.v1`, and mutations that resolve to the **full patched document** so the query layer seeds its cache instead of refetching.

The stored document holds only `{ overlays: FlagOverlay[]; accessLog: ContentAccessEntry[] }`. Conversations come from `readStoredConversations()` on every `list()` — read-only, never written back.

- `list()` — read conversations, `deriveFlags`, `toConversationRows`, `buildOverview`, return `{ rows, overview, flags, accessLog }`.
- `openAccess(input)` — re-validate with `validateAccessReason` and **throw** when invalid; the dialog validates for the user's benefit, the service validates because it is the boundary. Append an entry with `id: 'ca-' + <monotonic>`, `openedAt: new Date().toISOString()`, `closedAt: null`, `outcome: null`. Resolve to the entry.
- `closeAccess({ id, outcome })` — patch that entry's `closedAt` and `outcome`. Never removes it.
- `setFlagStatus({ flagId, status, decidedBy })` — upsert an overlay with `resolution: null`.
- `resolveFlag({ flagId, resolution, note, decidedBy })` — reject an empty or whitespace-only note; upsert an overlay with `status: 'resolved'`.

- [ ] **Step 4: Run and watch it pass**

```bash
npm run test -- src/features/admin/communications/communications.api
```

Expected: PASS.

- [ ] **Step 5: Prove the guarantees can fail**

| Mutation | Test that must fail |
| --- | --- |
| Add a `deleteAccessEntry` key to `communicationsApi` | "exposes no verb that edits or deletes an access-log entry" |
| Drop the `validateAccessReason` re-check in `openAccess` | "refuses a reason under the floor rather than trusting the dialog" |
| Have `closeAccess` remove the entry instead of patching it | "closes an open entry as completed" |
| Call `writeStoredConversations` anywhere in the service | "is never written by this service" |

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/admin/communications
git commit -m "feat(adm-06b): mock service with an append-only content-access log"
```

---

### Task 6: Query layer and the section slug

The slug and its `SECTION_META` entry land **in this task**, not later: ADM-07 split them across tasks and typecheck could not pass in between, costing a restart.

**Files:**
- Create: `frontend/src/features/admin/communications/communications.queries.ts`
- Modify: `frontend/src/features/admin/administration.types.ts` — add `'communications'` to `AdminSectionSlug`
- Modify: `frontend/src/features/admin/administration.meta.ts` — add the `SECTION_META.communications` entry
- Modify: `frontend/src/routes/index.ts` — only if the slug union is re-declared there

**Interfaces:**
- Produces: `communicationsKeys`, `useCommunicationsDocument()`, `useOpenAccessMutation()`, `useCloseAccessMutation()`, `useSetFlagStatusMutation()`, `useResolveFlagMutation()`.

- [ ] **Step 1: Find where the slug union lives**

```bash
grep -rn "AdminSectionSlug" frontend/src/routes/index.ts frontend/src/features/admin/administration.types.ts
```

Add `'communications'` to the union wherever it is declared, and a `SECTION_META.communications` entry with a label, a one-line description and a `lucide-react` icon — `MessagesSquare` fits the existing set. `administration.meta.test.ts` asserts meta/route agreement; keep it green.

- [ ] **Step 2: Write the query layer**

Create `frontend/src/features/admin/communications/communications.queries.ts`:

```ts
/**
 * Communication monitoring — TanStack Query hooks (ADM-06).
 *
 * One query for the whole screen. All three tabs read the same cache entry,
 * so a flag resolved on the flags tab is already true in the Overview flag
 * rate — no refetch, and no chance of the two disagreeing.
 *
 * Mutations resolve to the full patched document and seed the cache with
 * `setQueryData`, the StrictMode-safe pattern used across the app.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  communicationsApi,
  type CloseAccessInput,
  type FlagStatusInput,
  type OpenAccessInput,
  type ResolveFlagInput,
} from './communications.api';
import type { CommunicationsDocument } from './communications.types';

const STALE_MS = 30_000;

export const communicationsKeys = {
  all: ['admin', 'communications'] as const,
  document: () => [...communicationsKeys.all, 'document'] as const,
} as const;

export function useCommunicationsDocument() {
  return useQuery({
    queryKey: communicationsKeys.document(),
    queryFn: communicationsApi.list,
    staleTime: STALE_MS,
  });
}

function useDocumentMutation<TInput>(
  mutationFn: (input: TInput) => Promise<CommunicationsDocument>,
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (document) => {
      client.setQueryData(communicationsKeys.document(), document);
    },
  });
}

export function useSetFlagStatusMutation() {
  return useDocumentMutation<FlagStatusInput>(communicationsApi.setFlagStatus);
}

export function useResolveFlagMutation() {
  return useDocumentMutation<ResolveFlagInput>(communicationsApi.resolveFlag);
}

/**
 * The exception to the pattern above: this resolves to the access-log ENTRY,
 * not the document, because its `id` is the reference the viewer banner
 * shows and the caller needs it in hand. The document is invalidated after,
 * since the access log it contains has changed.
 */
export function useOpenAccessMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: OpenAccessInput) => communicationsApi.openAccess(input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: communicationsKeys.document() });
    },
  });
}

export function useCloseAccessMutation() {
  return useDocumentMutation<CloseAccessInput>(communicationsApi.closeAccess);
}
```

`closeAccess` therefore resolves to the full document, unlike `openAccess`. Make Task 5's implementation match: `openAccess` returns `ContentAccessEntry`, every other verb returns `CommunicationsDocument`.

- [ ] **Step 3: Run the gates**

```bash
npm run typecheck && npm run lint && npm run test
```

Expected: all green. Typecheck is the real check here — an incomplete `SECTION_META` record fails it.

- [ ] **Step 4: Commit**

```bash
git add frontend/src
git commit -m "feat(adm-06b): query layer and the communications section slug"
```

---

### Task 7: The section shell, its capability gate, and the Overview tab

`useCan()` from `@/app/providers` returns `(permission) => boolean`; `AdminOverviewSection.test.tsx` shows the house way to mock it.

**Files:**
- Create: `frontend/src/features/admin/communications/CommunicationsSection.tsx`
- Create: `frontend/src/features/admin/communications/CommunicationsSection.test.tsx`
- Create: `frontend/src/features/admin/communications/OverviewTab.tsx`

**Interfaces:**
- Consumes: `SectionShell` from `../components/SectionShell`; `AsyncSection`, `Panel`, `MetricTile` from `../components/primitives`; `LineAreaChart` from `@/components/charts`; `useCommunicationsDocument` from `./communications.queries`.
- Produces: `CommunicationsSection`, `OverviewTab({ overview })`.

- [ ] **Step 1: Write the failing capability test**

Create `frontend/src/features/admin/communications/CommunicationsSection.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CommunicationsSection } from './CommunicationsSection';

const capabilities = { current: [] as string[] };

vi.mock('@/app/providers', () => ({
  useCan: () => (permission: string) => capabilities.current.includes(permission),
  useAuth: () => ({ user: { name: 'Dr. Amelia Chen' } }),
}));

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/admin/communications?tab=logs']}>
        <CommunicationsSection />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  capabilities.current = [];
});

describe('the section gate', () => {
  it('denies the whole section without viewMetadata', async () => {
    capabilities.current = [];

    renderSection();

    expect(await screen.findByRole('alert')).toHaveTextContent(/permission/i);
    expect(screen.queryByRole('tab', { name: /conversation logs/i })).toBeNull();
  });

  it('renders all three tabs with viewMetadata', async () => {
    capabilities.current = ['communications.viewMetadata'];

    renderSection();

    expect(await screen.findByRole('tab', { name: /overview/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /conversation logs/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /safety flags/i })).toBeInTheDocument();
  });
});

describe('the content gate', () => {
  it('offers no content access with metadata only, once the data has settled', async () => {
    capabilities.current = ['communications.viewMetadata'];

    renderSection();

    // Wait for a ROW to exist first. Asserting the button's absence while the
    // query is still loading would pass against a completely broken gate —
    // the whole table is absent then, for an unrelated reason. ADM-01 shipped
    // exactly this defect and needed a second fix round to catch it.
    expect(await screen.findByText(/Dr\. Omar Khalil/)).toBeInTheDocument();

    expect(screen.queryByRole('button', { name: /request content access/i })).toBeNull();
    expect(screen.getByText(/oversight and clinical roles/i)).toBeInTheDocument();
  });

  it('offers content access when the capability is held', async () => {
    capabilities.current = ['communications.viewMetadata', 'communications.viewContent'];

    renderSection();

    expect(
      await screen.findAllByRole('button', { name: /request content access/i }),
    ).not.toHaveLength(0);
  });
});

describe('the flag gate', () => {
  it('shows flags read-only without resolveFlags', async () => {
    capabilities.current = ['communications.viewMetadata'];

    renderSection();
    await userEvent.click(await screen.findByRole('tab', { name: /safety flags/i }));

    expect(await screen.findByText(/severe chest pain/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^resolve/i })).toBeNull();
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
npm run test -- src/features/admin/communications/CommunicationsSection
```

Expected: FAIL — `Failed to resolve import "./CommunicationsSection"`.

- [ ] **Step 3: Write `CommunicationsSection.tsx`**

Shape, following `PatientsSection.tsx` and ADM-04's `PatientTabs` for the URL-owned tab:

```tsx
const TABS = ['overview', 'logs', 'flags'] as const;
type CommunicationsTab = (typeof TABS)[number];

/**
 * Validated, never cast. ADM-07 shipped `value as SortOrder` here and it
 * became a review finding: an unchecked cast lets a hand-edited URL put the
 * component into a state its own union says is impossible.
 */
function parseTab(value: string | null): CommunicationsTab {
  return TABS.find((tab) => tab === value) ?? 'overview';
}

export function CommunicationsSection() {
  const can = useCan();
  const [searchParams, setSearchParams] = useSearchParams();
  const document = useCommunicationsDocument();

  if (!can('communications.viewMetadata')) {
    return (
      <SectionShell slug="communications">
        <AccessDeniedAlert capability="communications.viewMetadata" />
      </SectionShell>
    );
  }

  const tab = parseTab(searchParams.get('tab'));

  return (
    <SectionShell slug="communications" toolbar={<TabList value={tab} onChange={setTab} />}>
      <AsyncSection
        isLoading={document.isLoading}
        isError={document.isError}
        onRetry={() => void document.refetch()}
      >
        {document.data === undefined ? null : (
          <>
            {tab === 'overview' ? <OverviewTab overview={document.data.overview} /> : null}
            {tab === 'logs' ? <ConversationLogsTab document={document.data} /> : null}
            {tab === 'flags' ? <SafetyFlagsTab document={document.data} /> : null}
          </>
        )}
      </AsyncSection>
    </SectionShell>
  );
}
```

Rules for this file:

- The denial alert renders `role="alert"` and quotes the matrix's own `lockReason` for `communications.viewContent` — *"Content access is limited to oversight and clinical roles."* Read it via `findCapability` from `../permissions` rather than retyping the string, so the matrix and the screen cannot drift.
- The three tabs always render as tabs. The capabilities gate what is **inside** them, not whether they exist: an admin with metadata only still sees the flags queue, read-only.

- [ ] **Step 4: Write `OverviewTab.tsx`**

`MetricTile` for the four scalars, `LineAreaChart` for the trend, each inside a `Panel`.

- `medianResponseMinutes === null` renders `—` with the hint "no answered messages yet". Never `0` — a practice that has answered nothing and a practice that answers instantly are not the same fact.
- `flagRate` renders as a percentage to one decimal.
- **No message content on this tab.** No excerpt, no topic, no participant name — not in a label, not in a tooltip, not in an empty state.
- The trend's series is `overview.volume` verbatim. Recomputing anything here would create the second derivation this architecture exists to prevent.

- [ ] **Step 5: Add aggregate export**

§3.6 lists "export aggregate reports" among the user actions. **Aggregate export only** — content export requires elevated permission and produces a watermarked artifact, and is explicitly out of scope (spec §11). No partial affordance ships: there is no disabled "export transcript" button anywhere.

Append the test:

```tsx
describe('aggregate export', () => {
  beforeEach(() => {
    capabilities.current = ['communications.viewMetadata'];
  });

  it('exports the aggregates and offers no content export', async () => {
    renderSection();
    await userEvent.click(await screen.findByRole('tab', { name: /overview/i }));

    expect(
      await screen.findByRole('button', { name: /export aggregates/i }),
    ).toBeInTheDocument();
    // Content export is out of scope, so it must be absent — not present
    // and disabled, which would advertise a capability that does not exist.
    expect(screen.queryByRole('button', { name: /transcript|content/i })).toBeNull();
  });
});
```

Wire the button to `exportCsv` from `@/utils/export` over a row set built from the five aggregates — figure name and value, nothing else. `utils/export.ts` already has `exportCsv` and `exportJson` (ADM-07 added the latter); do not write a new exporter.

The export writes a `data-export` log event naming what was exported, as ADM-07's does. ADM-07 shipped an export that honoured its filters but had nothing pinning it, and a mutation showed 174 rows exported where 10 were requested — so assert the emitted row count matches the five aggregates, not merely that a file was produced.

**jsdom has no object-URL support**; `src/test/setup.ts` already stubs it for ADM-07's export tests, so this inherits the stub. Do not mock the exporter itself — that would make the assertion vacuous.

- [ ] **Step 6: Run tests and gates**

```bash
npm run test -- src/features/admin/communications
npm run typecheck && npm run lint
```

- [ ] **Step 7: Prove the content gate is defended by the capability, not by loading**

Mutate `ConversationLogsTab` so the request-access affordance renders regardless of `can('communications.viewContent')`. Confirm **"offers no content access with metadata only, once the data has settled"** fails.

If it still passes, the test is discriminating on the loading state rather than on the gate. Fix the test before continuing — a gate test that passes against a removed gate is worse than no test, because it will be believed.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/features/admin/communications
git commit -m "feat(adm-06b): section shell, capability gates and the Overview tab"
```

---

### Task 8: The conversation metadata table

**Files:**
- Create: `frontend/src/features/admin/communications/ConversationLogsTab.tsx`
- Modify: `frontend/src/features/admin/communications/CommunicationsSection.test.tsx` (append)

**Interfaces:**
- Consumes: `DataGrid` from `../components/DataGrid`; `MaskedIdentifier` from `../phi`; `filterRows`, `sortRows` from `./communications`.
- Produces: `ConversationLogsTab({ document })`.

- [ ] **Step 1: Append the table tests**

```tsx
describe('the metadata table', () => {
  beforeEach(() => {
    capabilities.current = ['communications.viewMetadata'];
  });

  it('names the doctor and masks the patient', async () => {
    renderSection();

    expect(await screen.findByText(/Dr\. Omar Khalil/)).toBeInTheDocument();
    // The cleartext name must not be in the DOM at all. Masking that only
    // hides visually is not masking — it is a CSS class over a leak.
    expect(screen.queryByText('Mona Adel')).toBeNull();
  });

  it('filters to flagged conversations only', async () => {
    renderSection();
    const before = (await screen.findAllByRole('row')).length;

    await userEvent.click(screen.getByRole('button', { name: /flagged/i }));

    expect((await screen.findAllByRole('row')).length).toBeLessThan(before);
  });

  it('labels a row action by conversation, never by patient', async () => {
    capabilities.current = ['communications.viewMetadata', 'communications.viewContent'];
    renderSection();

    const [button] = await screen.findAllByRole('button', {
      name: /request content access/i,
    });
    if (button === undefined) throw new Error('expected a request button');
    // A control's accessible name is announced aloud and lands in logs.
    // ADM-04 established this rule for the same reason.
    expect(button).toHaveAccessibleName(/conversation cv-/i);
    expect(button).not.toHaveAccessibleName(/Mona/i);
  });
});
```

**The DS `Select` is a button + listbox, not a native `<select>` — `userEvent.selectOptions` does not work on it.** Click the combobox, then click the option. jsdom has no `scrollIntoView` and the DS `Select` calls it on open; `src/test/setup.ts` already stubs it.

- [ ] **Step 2: Run and watch it fail**

```bash
npm run test -- src/features/admin/communications/CommunicationsSection
```

- [ ] **Step 3: Write `ConversationLogsTab.tsx`**

Columns: participants · started · last activity · messages · status · flags · actions.

- The participants cell renders `row.doctorName` as text, and when `row.patientId` is non-null a `MaskedIdentifier` with `subjectId={row.patientId}`, `subjectLabel={`Conversation ${row.id}`}` (non-identifying, per its own docstring), `kind="name"` and `value={row.patientName}`.
- `query`, `status`, `flagged` and `sort` are URL-owned alongside `tab`, so a filtered view is linkable — the ADM-01/ADM-07 house pattern.
- The actions cell renders **"Request content access for conversation cv-…"** only when `can('communications.viewContent')`. Without the capability the tab renders the denial alert once above the table, not a disabled button on every row: forty disabled buttons teach nothing, one sentence explains.
- Empty state: "No conversations match these filters."

- [ ] **Step 4: Run tests and gates, then commit**

```bash
npm run test -- src/features/admin/communications
npm run typecheck && npm run lint
git add frontend/src/features/admin/communications
git commit -m "feat(adm-06b): conversation metadata table with masked participants"
```

---

### Task 9: The justification gate

**Files:**
- Create: `frontend/src/features/admin/communications/ContentAccessProvider.tsx`
- Create: `frontend/src/features/admin/communications/ContentAccessDialog.tsx`
- Modify: `frontend/src/features/admin/communications/CommunicationsSection.test.tsx` (append)

**Interfaces:**
- Consumes: `grantForConversation`, `validateAccessReason`, `isLive`, `CONTENT_ACCESS_CATEGORIES` from `./communications`; `useOpenAccessMutation`, `useCloseAccessMutation` from `./communications.queries`.
- Produces: `ContentAccessProvider`, and `useContentAccess()` returning `{ grant, ref, request, release, isLiveFor }`.

- [ ] **Step 1: Append the gate tests**

```tsx
describe('the justification gate', () => {
  beforeEach(() => {
    capabilities.current = ['communications.viewMetadata', 'communications.viewContent'];
  });

  it('requires a justification category before it will submit', async () => {
    renderSection();
    const [button] = await screen.findAllByRole('button', {
      name: /request content access/i,
    });
    if (button === undefined) throw new Error('expected a request button');
    await userEvent.click(button);

    expect(screen.getByRole('button', { name: /open conversation/i })).toBeDisabled();
  });

  it('refuses a reason under the floor and grants nothing', async () => {
    renderSection();
    const [button] = await screen.findAllByRole('button', {
      name: /request content access/i,
    });
    if (button === undefined) throw new Error('expected a request button');
    await userEvent.click(button);

    await userEvent.click(screen.getByRole('radio', { name: /quality audit/i }));
    await userEvent.type(screen.getByLabelText(/reason/i), 'too short');
    await userEvent.click(screen.getByRole('button', { name: /open conversation/i }));

    // The literal 20 is deliberate and appears only here: this asserts the
    // sentence a USER reads, which `audited-access` builds by interpolating
    // COMMS_REASON_MIN_LENGTH. Changing the constant should fail this test —
    // the on-screen copy changed.
    expect(await screen.findByText(/at least 20 characters/i)).toBeInTheDocument();
  });

  it('warns that the access is attributed before it is taken', async () => {
    renderSection();
    const [button] = await screen.findAllByRole('button', {
      name: /request content access/i,
    });
    if (button === undefined) throw new Error('expected a request button');
    await userEvent.click(button);

    expect(screen.getByText(/recorded against your name/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
npm run test -- src/features/admin/communications/CommunicationsSection
```

- [ ] **Step 3: Write `ContentAccessProvider.tsx`**

Holds at most one grant, in React state, **never persisted**. The PHI provider's docstring gives the reason and it applies here unchanged: a grant must not survive a reload, a new tab, or a re-login, because "I justified this an hour ago" is not a justification for now.

```tsx
export interface ContentAccessValue {
  readonly grant: ContentGrant | null;
  /** The access-log entry id — the "ref #" the viewer banner shows. */
  readonly ref: string | null;
  request: (input: {
    conversationId: string;
    category: ContentAccessCategory;
    reason: string;
  }) => Promise<void>;
  release: (outcome: 'completed' | 'incomplete') => void;
  isLiveFor: (conversationId: string) => boolean;
}
```

- `request` calls `openAccess`, stores the returned entry's `id` as `ref`, and issues the grant with `grantForConversation`.
- `isLiveFor(id)` is `grant !== null && grant.subjectId === id && isLive(grant, Date.now())`. **Fail closed:** a null grant, a mismatched id, or an elapsed window each return `false`.
- `release(outcome)` calls `closeAccess` with that outcome, then clears `grant` and `ref`.
- An effect sets one timer for `grant.expiresAt - Date.now()` that calls `release('incomplete')`. **Clear it by its own id in the effect's cleanup** — a shared ref leaks the superseded timer, which this codebase has hit before (Phase 10).

- [ ] **Step 4: Write `ContentAccessDialog.tsx`**

A modal with a required category — a radio group over `CONTENT_ACCESS_CATEGORIES`, each option showing its `description` — and a required free-text reason. Submit stays disabled until a category is chosen.

On submit, `validateAccessReason` decides: invalid renders its `message` beside the field and does **not** call `request`.

Copy above the field, verbatim: **"This access is recorded against your name and is visible to whoever audits it."** It is placed before the reason field rather than after the button, because a warning shown after the decision is decoration.

- [ ] **Step 5: Run tests and gates, then commit**

```bash
npm run test -- src/features/admin/communications
npm run typecheck && npm run lint
git add frontend/src/features/admin/communications
git commit -m "feat(adm-06b): justification dialog and the in-memory content grant"
```

---

### Task 10: The watermarked reader

**Files:**
- Create: `frontend/src/features/admin/communications/ConversationViewerPage.tsx`
- Create: `frontend/src/features/admin/communications/WatermarkOverlay.tsx`
- Create: `frontend/src/features/admin/communications/ConversationViewerPage.test.tsx`

**Interfaces:**
- Consumes: `useContentAccess` from `./ContentAccessProvider`; `readStoredConversations`, `SEED_CONTACTS`, `ME_ID` from `@/features/shared-domain/conversations`.
- Produces: `ConversationViewerPage`.

- [ ] **Step 1: Write the failing viewer test**

Create `frontend/src/features/admin/communications/ConversationViewerPage.test.tsx`. Write two local helpers — one mounting the provider with no grant, one with a grant whose `expiresAt` is already in the past — then:

```tsx
describe('the viewer route', () => {
  it('denies and renders no thread when no grant is live', async () => {
    // The defence that exists only because this is a route: a URL someone can
    // type, bookmark, mail, or return to after the grant lapsed.
    renderViewerWithoutGrant('/admin/communications/cv-referral');

    expect(await screen.findByRole('alert')).toHaveTextContent(/no active content access/i);
    expect(screen.queryByTestId('conversation-thread')).toBeNull();
  });

  it('renders nothing at all when the grant has expired', async () => {
    renderViewerWithExpiredGrant('/admin/communications/cv-referral');

    expect(screen.queryByTestId('conversation-thread')).toBeNull();
    // Not a shell, not a header, not a watermark over an empty surface.
    expect(screen.queryByTestId('watermark')).toBeNull();
  });

  it('shows the banner reference when a grant is live', async () => {
    renderViewerWithLiveGrant('/admin/communications/cv-referral', 'ca-7');

    expect(await screen.findByRole('status')).toHaveTextContent(/ca-7/);
    expect(screen.getByTestId('conversation-thread')).toBeInTheDocument();
  });

  it('offers no way to write into the conversation', async () => {
    renderViewerWithLiveGrant('/admin/communications/cv-referral', 'ca-7');
    await screen.findByTestId('conversation-thread');

    // Read-only is a property of what is rendered, not of an intention.
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /send|reply|archive|star/i })).toBeNull();
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
npm run test -- src/features/admin/communications/ConversationViewerPage
```

- [ ] **Step 3: Write `WatermarkOverlay.tsx`**

```tsx
/**
 * Diagonal watermark bearing the reading administrator's name.
 *
 * Presentation, not protection — the protection is the grant and the log.
 * It exists so a screenshot carries its own provenance, and so the reader is
 * never unaware of being recorded.
 *
 * `aria-hidden` because a screen-reader user should hear the banner, which
 * says the same thing once, rather than the name repeated 192 times.
 */
export function WatermarkOverlay({ name, at }: { name: string; at: string }) {
  return (
    <div
      aria-hidden="true"
      data-testid="watermark"
      className="pointer-events-none absolute inset-0 select-none overflow-hidden opacity-[0.07]"
    >
      <div className="absolute -inset-1/4 rotate-[-30deg] text-body-sm font-semibold leading-[3rem] tracking-widest text-text-primary">
        {Array.from({ length: 24 }, (_, row) => (
          <div key={row} className="whitespace-nowrap">
            {`${name} · ${at} · `.repeat(8)}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Write `ConversationViewerPage.tsx`**

- Read `:conversationId` from `useParams`.
- **The first thing after the hooks:** if `conversationId === undefined || !isLiveFor(conversationId)`, render the denial alert and return. No thread, no watermark, no header, no content computed.
- The persistent banner is `role="status"`, sticky at the top: `You are viewing private communication — access logged (ref {ref})`.
- The thread is `data-testid="conversation-thread"`, rendering author label, timestamp and body per message. **No composer, no reply, no star, no archive** — this feature never writes a message.
- `ME_ID` resolves to the signed-in doctor's display name, not the sentinel string `'me'`.
- On unmount, `release('completed')`. On expiry the provider's timer has already called `release('incomplete')`, which flips `isLiveFor` to false and re-renders into the denial branch — one path, two triggers.

- [ ] **Step 5: Prove the guard is real**

Mutate `ConversationViewerPage` to render the thread regardless of `isLiveFor`. Confirm **all three** of the deny/expired/read-only tests fail. Restore and re-run.

- [ ] **Step 6: Run tests and gates, then commit**

```bash
npm run test -- src/features/admin/communications
npm run typecheck && npm run lint
git add frontend/src/features/admin/communications
git commit -m "feat(adm-06b): watermarked read-only viewer behind a live grant"
```

---

### Task 11: The safety-flag queue

**Files:**
- Create: `frontend/src/features/admin/communications/SafetyFlagsTab.tsx`
- Create: `frontend/src/features/admin/communications/FlagResolveDialog.tsx`
- Modify: `frontend/src/features/admin/communications/CommunicationsSection.test.tsx` (append)

**Interfaces:**
- Consumes: `useSetFlagStatusMutation`, `useResolveFlagMutation` from `./communications.queries`; `FLAG_CATEGORY_LABEL`, `ALL_FLAG_CATEGORIES` from `./flag-rules`.
- Produces: `SafetyFlagsTab({ document })`.

- [ ] **Step 1: Append the queue tests**

```tsx
describe('the safety-flag queue', () => {
  beforeEach(() => {
    capabilities.current = ['communications.viewMetadata', 'communications.resolveFlags'];
  });

  it('shows the matched message only, not the surrounding thread', async () => {
    renderSection();
    await userEvent.click(await screen.findByRole('tab', { name: /safety flags/i }));

    expect(await screen.findByText(/severe chest pain/i)).toBeInTheDocument();
    // A neighbouring seeded message must not be on this tab. An excerpt that
    // quietly grows into context is an ungated reader.
    expect(screen.queryByText(/Atorvastatin/i)).toBeNull();
  });

  it('links to the conversation row, never straight into the reader', async () => {
    renderSection();
    await userEvent.click(await screen.findByRole('tab', { name: /safety flags/i }));

    const [link] = await screen.findAllByRole('link', { name: /view conversation/i });
    if (link === undefined) throw new Error('expected a conversation link');
    // A one-click path from a flag to message content would be a way around
    // the gate. The link goes to the metadata row; reading still costs a
    // justification.
    expect(link).toHaveAttribute('href', expect.stringContaining('tab=logs'));
  });

  it('empties to the §3.6 message once every flag is resolved', async () => {
    renderSection();
    await userEvent.click(await screen.findByRole('tab', { name: /safety flags/i }));

    for (;;) {
      const [button] = screen.queryAllByRole('button', { name: /^resolve/i });
      if (button === undefined) break;
      await userEvent.click(button);
      await userEvent.click(screen.getByRole('radio', { name: /dismiss/i }));
      await userEvent.type(
        screen.getByLabelText(/note/i),
        'Reviewed and contacted the participant directly.',
      );
      await userEvent.click(screen.getByRole('button', { name: /record decision/i }));
    }

    // Reached by resolving, not by an unseeded store — the spec requires this
    // path to be reachable, and an empty state only ever seen on a fresh
    // install is an empty state nobody has tested.
    expect(await screen.findByText('No open flags ✓')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
npm run test -- src/features/admin/communications/CommunicationsSection
```

- [ ] **Step 3: Write `SafetyFlagsTab.tsx`**

One card per flag, grouped by conversation, newest first. Each card shows the category badge, the source badge (auto/user), the excerpt in a quoted block, the author label, the timestamp and the status.

- Filter chips by status (`open` by default) and by category.
- Actions render only with `can('communications.resolveFlags')`: "Mark under review" and "Resolve…".
- Empty state, verbatim: `No open flags ✓`.
- **A persistent note on the tab stating what auto-flagging does not do** — spec §6.3 makes this a requirement, not a nicety. Wording to the effect that automatic flagging is keyword-based, catches only some phrasings, and is not a substitute for clinical triage. Measured recall on unseen phrasing is poor (one review round scored 1 of 22 on fresh emergency wordings), and an administrator who believes this queue catches every emergency is worse off than one who knows it does not. The false assurance is the hazard, not the missed keyword.
- The conversation link goes to `/admin/communications?tab=logs&query=<conversationId>` — the metadata row, **not** the viewer.

- [ ] **Step 4: Write `FlagResolveDialog.tsx`**

A radio group over the three resolutions — "Dismiss", "Warn the participant", "Escalate for suspension" — plus a required note. Submit stays disabled until a resolution is chosen and the note is non-empty after trimming.

On submit:

- `dismissed` / `warned` → `resolveFlag`, then close.
- `escalated` → `resolveFlag`, then navigate to `/admin/doctors/:id` when the flagged author is a doctor, or `/admin/patients/:id` when a patient, carrying `?flagRef=<flag.id>`.

**This dialog never suspends anyone.** ADM-02/03 and ADM-04 own suspension, each with its own reason capture and audit write; the destination screen's existing flow does the work. A second implementation of suspension policy is a hardening fix that reaches one copy and misses the other.

- [ ] **Step 5: Run tests and gates, then commit**

```bash
npm run test -- src/features/admin/communications
npm run typecheck && npm run lint
git add frontend/src/features/admin/communications
git commit -m "feat(adm-06b): safety-flag queue with the resolve workflow"
```

---

### Task 12: Close the three cross-links

Three parked comments in shipped code name ADM-06 as their blocker. ADM-01's and ADM-07's suites are part of this task's gate.

**Files:**
- Modify: `frontend/src/features/admin/logs/logs.types.ts`, `logs.ts`, `logs.test.ts`
- Modify: `frontend/src/features/admin/overview/overview.types.ts`, `overview.ts`, and the ADM-01 tests
- Modify: `frontend/src/features/admin/communications/communications.api.ts`

**Interfaces:**
- Produces: `LogEventType` gains `'communication-content-accessed'`; `SecurityAlertKind` gains its flagged-communications member; the ADM-01 action queue gains a fifth row.

- [ ] **Step 1: Add the log event type**

In `logs.types.ts`, add `'communication-content-accessed'` to `LogEventType` under the **security** group — a gated read of private messages is a security event, not an admin-activity one.

In `logs.ts` add three things: its `TYPE_CATEGORY` mapping, its entry in `ALL_EVENT_TYPES` (the independent literal list — deliberately **not** derived from `TYPE_CATEGORY`, so that a totality test cannot be self-referential), and its `EVENT_TYPE_LABEL` string `'Read message content'`.

- [ ] **Step 2: Pin the mapping**

Append to `logs.test.ts`:

```ts
it('classifies a gated content read as a security event', () => {
  expect(TYPE_CATEGORY['communication-content-accessed']).toBe('security');
});

it('lists the content-access type among all event types', () => {
  expect(ALL_EVENT_TYPES).toContain('communication-content-accessed');
});
```

The existing bidirectional agreement test between `ALL_EVENT_TYPES` and `TYPE_CATEGORY` fails if you add one and forget the other. That is the test doing its job — add both.

- [ ] **Step 3: Emit the event from `openAccess`**

`communicationsApi.openAccess` writes a log event of that type alongside its access-log entry, **using the same id**. That equality is what makes the banner's reference findable in `/admin/logs`.

`target` is the conversation id — a record reference, never a patient's name, per `LogEvent.target`'s own docstring.

Extend Task 5's round-trip test to assert the log event carries the entry's id:

```ts
it('writes a log event under the same id as the access entry', async () => {
  const entry = await communicationsApi.openAccess({
    conversationId: 'cv-referral',
    category: 'legal-request',
    reason: 'Documented request from the compliance team',
    actor: 'Dr. Amelia Chen',
  });

  const events = await logsApi.list({
    filters: {
      query: '',
      actorRole: 'all',
      actor: '',
      type: 'communication-content-accessed',
      severity: 'all',
      from: '',
      to: '',
      ip: '',
    },
    sort: 'newest',
    offset: 0,
    limit: 50,
  });

  // One identifier, not two. The ref an admin reads on screen is the row an
  // auditor finds in the log.
  expect(events.rows.some((row) => row.id === entry.id)).toBe(true);
});
```

- [ ] **Step 4: Add ADM-01's fifth queue row and the alert kind**

In `overview.types.ts`, add the flagged-communications member to `SecurityAlertKind`, and replace the two "deliberately absent — needs ADM-06" comments with what is now true.

In `overview.ts`, derive both from the communications document: the queue row counts open flags and carries its destination `/admin/communications?tab=flags&status=open` **with the filter already applied**, like the other four rows. The alert fires above a threshold declared as a named constant beside it, never an inline number.

- [ ] **Step 5: Run the affected suites explicitly, then everything**

```bash
npm run test -- src/features/admin/logs src/features/admin/overview src/features/admin/communications
npm run test
```

Expected: all green. If an ADM-01 assertion counts four queue rows, updating it to five is correct and expected — say so explicitly in your report rather than letting it look like an incidental edit.

- [ ] **Step 6: Commit**

```bash
git add frontend/src
git commit -m "feat(adm-06b): close the ADM-07 taxonomy and ADM-01 queue cross-links"
```

---

### Task 13: Mount, navigate, document, verify

**Files:**
- Modify: `frontend/src/features/admin/routes.tsx`
- Modify: `frontend/src/layouts/navigation.ts`
- Modify: `frontend/src/features/admin/routes.test.tsx`
- Modify: `frontend/FRONTEND_CHECKLIST.md`

- [ ] **Step 1: Mount the routes**

In `routes.tsx`, add the section and its viewer child. The viewer is a **child route** so `useMatches()` builds "Communications › Conversation" on its own, the pattern the doctors profile and Platform Settings already use:

```tsx
{
  path: 'communications',
  handle: { crumb: 'Communications' } satisfies RouteHandle,
  children: [
    {
      index: true,
      lazy: async () => {
        const { CommunicationsSection } = await import(
          './communications/CommunicationsSection'
        );
        return { Component: CommunicationsSection };
      },
    },
    {
      path: ':conversationId',
      handle: { crumb: 'Conversation' } satisfies RouteHandle,
      lazy: async () => {
        const { ConversationViewerPage } = await import(
          './communications/ConversationViewerPage'
        );
        return { Component: ConversationViewerPage };
      },
    },
  ],
},
```

`ContentAccessProvider` wraps both children, so a grant taken on the table survives the navigation into the viewer.

- [ ] **Step 2: Add the navigation entry**

In `layouts/navigation.ts`, add Communications to `adminNavigation` in the group holding Patients and Logs. `active-item.ts`'s `isItemActive` already does most-specific matching, so the viewer route lights the Communications item rather than `/admin`.

- [ ] **Step 3: Extend the routes test**

Assert the section path resolves and that the viewer path is a child of it. Mutation-check it: change the child's `path` and confirm the test fails.

`routes.test.tsx` documents a known limitation — `createMemoryRouter` cannot run in this jsdom setup, so the test re-declares parent nesting and would not catch an `app/router` change. **Do not claim more than it verifies** in your report.

- [ ] **Step 4: Run all four gates**

```bash
npm run typecheck && npm run lint && npm run test && npm run build
```

Expected: typecheck clean; lint 0 errors with the 20 pre-existing warnings; every test green; build succeeds. Record the test count and the build time.

- [ ] **Step 5: Verify in the browser**

Start the dev server with `preview_start` using `.claude/launch.json`. If port 5173 is held by another session, add an entry on a free port with `runtimeArgs: ["--prefix", "frontend", "run", "dev", "--", "--port", "<port>"]` — Vite hardcodes 5173 in `vite.config.ts`, so `autoPort` alone will not move it.

Sign in as `admin@medora.health` / `Medora123!` and confirm each claim separately:

1. `/admin/communications` renders three tabs; Overview shows five figures and **no message text anywhere**.
2. The logs tab names doctors and shows patients masked.
3. "Request content access" with a short reason is refused; with a category and a valid reason it opens the viewer.
4. The viewer shows the watermark and the banner, and the banner's ref appears in `/admin/logs` as a "Read message content" row.
5. Navigating back and then re-entering the viewer URL **denies** — the grant was released on unmount.
6. The flags tab lists the three seeded flags; resolving one moves it out of the open filter.
7. `/admin` shows the fifth queue row and its count equals the open-flag count on the flags tab.
8. `read_console_messages` is clean.

Then sign in as `doctor@medora.health` / `Medora123!` and confirm `/admin/communications` is unreachable — the admin area has been admin-only since Phase 19.

- [ ] **Step 6: Update the checklist**

In `frontend/FRONTEND_CHECKLIST.md`, change the ADM-06 row to ✅ in the style of the ADM-01 and ADM-07 rows: what shipped, the decisions a reader would otherwise re-litigate, and — explicitly — **what is not done**: second-admin approval, content export, participant-visible transparency logs, and the harassment category having no seeded instance.

Update §4's line naming ADM-06 and ADM-08 as the two remaining sections; only ADM-08 remains.

- [ ] **Step 7: Commit**

```bash
git add frontend
git commit -m "feat(adm-06b): mount Communication Monitoring and close the ADM-06 row"
```

---

## Notes for the implementer

**The success claim is not "the screen works" — it is "the screen cannot be talked past."** Three properties carry it, and each is easy to ship broken while every test passes:

1. **The content gate is defended by the capability, not by a loading state.** ADM-01 shipped exactly this bug: a test asserting an affordance was absent, passing because the whole table was absent while the query loaded. Every capability test here waits for real data first.
2. **The viewer renders nothing without a live grant** — not a shell, not a header, not a watermark over an empty surface.
3. **The three tabs cannot disagree**, because they are three views of one derived document. If you find yourself computing a count inside a component, stop: it belongs in `buildOverview`.

**Where this goes wrong quietly:**

- **A false-positive detector.** A rule that fires on ordinary clinical conversation buries the real flags and teaches a reviewer to dismiss the queue unread. Every detector has negative fixtures for this reason; never delete one to make a positive case pass.
- **An excerpt that grows.** `SafetyFlag` has no `body` field deliberately. Adding surrounding messages "for context" turns the queue into an ungated reader.
- **`patientName` reaching a filter or a search index.** It exists on `ConversationRow` only to hand to `MaskedIdentifier`. ADM-04 kept patients out of `useAdminSearchIndex` for exactly this reason — do not add conversations to it either.
- **Persisting the grant.** It must not survive a reload. The PHI provider's docstring explains why and applies unchanged.

**Observed, deliberately not fixed:** `FRONTEND_ARCHITECTURE.md` §9.1 still registers cross-feature domain models as living in `types/domain/`, a directory that does not exist, and four near-identical `validateReason` implementations remain (PHI's plus `admin/appointments`, `admin/doctors`, `admin/patients`). Both are sub-project A follow-ups and out of scope here.
