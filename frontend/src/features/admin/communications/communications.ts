/**
 * Communication monitoring — policy and pure derivations (ADM-06 · UX §3.6).
 *
 * The two policy numbers live here and nowhere else. `audited-access` takes
 * them as arguments precisely so a second consumer can choose differently
 * from PHI, and this is that second consumer.
 */

import type { NamedSeries, SeriesPoint } from '@/components/charts';
import {
  formatExpiry,
  grantFor,
  isLive,
  pruneGrants,
  validateReason,
  type AccessGrant,
  type ReasonValidation,
} from '@/features/shared-domain/audited-access';
import {
  ME_ID,
  SEED_CONTACTS,
  type ChatMessage,
  type Contact,
  type Conversation,
} from '@/features/shared-domain/conversations';
import { MOCK_PATIENTS } from '@/features/shared-domain/patient-identity';
import { maskMrn, maskName } from '@/utils/phi-mask';

import type {
  CommunicationsOverview,
  ContentAccessCategory,
  ConversationFilters,
  ConversationRow,
  ConversationSort,
  ConversationStatus,
  FlagOverlay,
  SafetyFlag,
} from './communications.types';
import { detectCategories, flagId } from './flag-rules';

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

/**
 * Rows, flags and the five overview figures — pure derivations (ADM-06B
 * Task 4). Every number the three tabs render is computed exactly once,
 * here: the Overview tab's flag rate and the Safety flags tab's queue
 * length are the same fact, not two separately-maintained counts free to
 * drift apart after a later edit. A sibling feature (ADM-07) shipped the
 * concrete version of that drift — the same record reachable through two
 * paths under different ids, which dedupe-by-id could not catch — which is
 * why this file exists in this shape.
 */

/** Age past which an unreplied patient message counts as unanswered. */
export const UNANSWERED_HOURS = 48;

/** Width of the message-volume trend, in trailing days including today. */
export const TREND_DAYS = 14;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/**
 * A conversation's participants, resolved to contacts. Skips `ME_ID`: it
 * is the signed-in doctor sentinel (see its docstring in
 * shared-domain/conversations), not a contact, and has no `SEED_CONTACTS`
 * row to resolve — looking it up would just fail, so this filters it out
 * instead.
 */
function participantsOf(
  conversation: Conversation,
  contacts: readonly Contact[],
): readonly Contact[] {
  const byId = new Map(contacts.map((contact) => [contact.id, contact] as const));
  const resolved: Contact[] = [];
  for (const participantId of conversation.participantIds) {
    if (participantId === ME_ID) continue;
    const contact = byId.get(participantId);
    if (contact !== undefined) resolved.push(contact);
  }
  return resolved;
}

function latestMessage(conversation: Conversation): ChatMessage | undefined {
  const { messages } = conversation;
  return messages[messages.length - 1];
}

/** One row per conversation — everything the table and the drawer render. */
export function toConversationRows(
  conversations: readonly Conversation[],
  contacts: readonly Contact[],
  flags: readonly SafetyFlag[],
  now: number,
): readonly ConversationRow[] {
  const flagCountByConversation = new Map<string, number>();
  for (const flag of flags) {
    flagCountByConversation.set(
      flag.conversationId,
      (flagCountByConversation.get(flag.conversationId) ?? 0) + 1,
    );
  }

  return conversations.map((conversation): ConversationRow => {
    const participants = participantsOf(conversation, contacts);
    const doctor = participants.find((participant) => participant.role === 'doctor');
    const patient = participants.find((participant) => participant.role === 'patient');
    const [first] = conversation.messages;
    const newest = latestMessage(conversation);

    // Unanswered means: the last word in the thread was the patient's, and
    // it has sat that way past the window. A doctor's own message last, or
    // a non-patient participant's, is not this condition — see the
    // `>` (not `>=`) boundary check locked in communications.test.ts.
    const unanswered =
      newest !== undefined &&
      patient !== undefined &&
      newest.authorId !== ME_ID &&
      newest.authorId === patient.id &&
      now - Date.parse(newest.sentAt) > UNANSWERED_HOURS * HOUR_MS;

    const status: ConversationStatus = conversation.archived
      ? 'archived'
      : unanswered
        ? 'unanswered'
        : 'active';

    return {
      id: conversation.id,
      doctorName: doctor?.name ?? 'Care team',
      patientId: patient?.id ?? null,
      patientName: patient?.name ?? null,
      participantCount: participants.length,
      startedAt: first?.sentAt ?? conversation.lastActivityAt,
      lastActivityAt: conversation.lastActivityAt,
      messageCount: conversation.messages.length,
      status,
      flagCount: flagCountByConversation.get(conversation.id) ?? 0,
    };
  });
}

/**
 * Every safety flag, derived fresh from the message text and merged with
 * whatever a reviewer already decided about it. A flag has no natural id
 * of its own — `flagId` gives it a deterministic one — so an overlay whose
 * flag no longer matches any rule (the rule changed, or the message did)
 * has nothing to attach to and is silently dropped, not carried forward as
 * an orphan.
 */
export function deriveFlags(
  conversations: readonly Conversation[],
  contacts: readonly Contact[],
  overlays: readonly FlagOverlay[],
): readonly SafetyFlag[] {
  const contactsById = new Map(contacts.map((contact) => [contact.id, contact] as const));
  const overlayById = new Map(overlays.map((overlay) => [overlay.flagId, overlay] as const));

  const flags: SafetyFlag[] = [];
  for (const conversation of conversations) {
    for (const message of conversation.messages) {
      const categories = detectCategories(message.body);
      if (categories.length === 0) continue;

      const author = contactsById.get(message.authorId);
      // Never the patient's name (§3.6): a patient author is always
      // "Patient", the doctor's own message is "You", anyone else (a
      // colleague) resolves to their contact name.
      const authorLabel =
        message.authorId === ME_ID
          ? 'You'
          : author !== undefined && author.role !== 'patient'
            ? author.name
            : 'Patient';

      for (const category of categories) {
        const id = flagId(conversation.id, message.id, category);
        const overlay = overlayById.get(id);

        flags.push({
          id,
          conversationId: conversation.id,
          messageId: message.id,
          category,
          source: 'auto',
          excerpt: message.body,
          authorLabel,
          at: message.sentAt,
          status: overlay?.status ?? 'open',
          resolution: overlay?.resolution ?? null,
          note: overlay?.note ?? null,
          decidedBy: overlay?.decidedBy ?? null,
          decidedAt: overlay?.decidedAt ?? null,
        });
      }
    }
  }
  return flags;
}

/**
 * Excerpt masking (§6.4, amended after browser verification). `deriveFlags`
 * above still stores `excerpt` raw — detection in `flag-rules.ts` runs on
 * the unmasked message, and masking the stored value would just be masking
 * one step earlier than masking at render, not a different thing. This is
 * the render-time transform every excerpt must go through instead: `flag.
 * excerpt` is never interpolated directly into a queue card again.
 *
 * Two shapes get masked, matched independently:
 *
 *  - Record identifiers — `PT-####` and `MRN ####-##`. The patterns below
 *    are written out again rather than imported, because `flag-rules.ts`
 *    exports no pattern to reuse (only `detectCategories`) and must not be
 *    changed to add one — masking before detection is exactly the bug this
 *    section exists to avoid. Keep these two patterns in sync with the
 *    `phi-wrong-channel` rule's `positive` list by hand; a rule widened
 *    there without a matching update here is a silent gap.
 *  - Patient names, found by literal match against the known patient
 *    roster (below) — this is not a name-shape heuristic (nothing here
 *    can guess "Fatima Zayed" is a person's name), only recognises the
 *    finite set of patient names the seed can produce.
 *
 * Doctor names are never touched: this feature names doctors throughout
 * and masks only patients, and that asymmetry (see `authorLabel` above,
 * and `MaskedIdentifier`'s use across the rest of `/admin`) is load-bearing,
 * not an oversight to "fix" by masking here too.
 */

/**
 * Mirrors `phi-wrong-channel`'s identifier patterns in `flag-rules.ts`.
 * `PT-\d{4}` is copied verbatim. The MRN pattern adds one thing flag-rules'
 * own copy does not need: an optional trailing `-\d+` group. Detection only
 * has to notice the `MRN` prefix and its leading digits to trip the rule —
 * flag-rules' pattern stops there. Masking has to hide the whole identifier
 * the message actually displays, and the seed writes MRNs as `MRN 4485-33`:
 * without the trailing group, the "-33" half would sail through unmasked
 * right next to the bullets hiding the rest of it.
 */
const PT_ID_PATTERN = /\bPT-\d{4}\b/g;
/** Captures the `MRN` label and its separator apart from the digits, so masking can replace the digits only and leave the label — same split `patient.mrn` vs. its `MRN`/`Medical record number` `<Fact>` label already keeps everywhere else in `/admin`. */
const MRN_PATTERN = /\b(MRN)([:\s-]?)(\d+(?:-\d+)?)/gi;

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Every patient name the queue could ever need to mask, from two sources
 * on purpose:
 *
 *  - `SEED_CONTACTS` filtered to `role === 'patient'` — the messaging
 *    seed's own roster, so a patient added there as a future conversation
 *    participant is covered without editing this file.
 *  - `MOCK_PATIENTS`, the shared clinical roster — because both excerpts
 *    browser verification actually caught (Omar Farouk, Layla Mansour) name
 *    patients who are never conversation participants, only mentioned in
 *    message text. `SEED_CONTACTS` alone has exactly one patient (Mona
 *    Adel) and would have missed both.
 *
 * Deduplicated through a `Set`, then sorted longest-first so that if the
 * roster ever gains a name that is a prefix of another, the longer form
 * matches whole rather than being cut short by the shorter one matching
 * first.
 */
function patientNames(): readonly string[] {
  return Array.from(
    new Set([
      ...SEED_CONTACTS.filter((contact) => contact.role === 'patient').map(
        (contact) => contact.name,
      ),
      ...MOCK_PATIENTS.map((patient) => patient.name),
    ]),
  ).sort((a, b) => b.length - a.length);
}

/*
 * Built on the first excerpt masked, not at module load (RM M40.4). Live code
 * imports this module for `categoryLabel` alone (via `logs/logs.ts`); a list
 * evaluated at load kept both demo rosters in a production bundle for it.
 */
let patientNamePattern: RegExp | null | undefined;
function patientNamePatternOnce(): RegExp | null {
  if (patientNamePattern === undefined) {
    const names = patientNames();
    patientNamePattern =
      names.length === 0
        ? null
        : new RegExp(`\\b(?:${names.map(escapeForRegExp).join('|')})\\b`, 'g');
  }
  return patientNamePattern;
}

/**
 * Renders an excerpt the way the metadata table renders a patient row:
 * identifiers and patient names replaced with the same masked shapes
 * `phi-mask.ts` produces everywhere else in `/admin`, doctor names and
 * everything else left as written. Pure — no gate, no reveal — because an
 * excerpt on this queue never gets a cleartext state; reading the real
 * value is what the content-access gate (a live grant, watermarked,
 * logged) is for.
 */
export function maskExcerpt(text: string): string {
  let masked = text.replace(PT_ID_PATTERN, (match) => maskMrn(match));
  masked = masked.replace(
    MRN_PATTERN,
    (_match, label: string, separator: string, digits: string) =>
      `${label}${separator}${maskMrn(digits)}`,
  );
  const namePattern = patientNamePatternOnce();
  if (namePattern !== null) {
    masked = masked.replace(namePattern, (match) => maskName(match));
  }
  return masked;
}

/**
 * Middle value of a sorted, non-empty run of numbers; the mean of the two
 * middles when the count is even. Null for an empty input — the caller
 * decides what an empty set means for its own metric.
 */
function medianOf(sortedValues: readonly number[]): number | null {
  if (sortedValues.length === 0) return null;

  const mid = Math.floor(sortedValues.length / 2);
  if (sortedValues.length % 2 === 1) {
    const middle = sortedValues[mid];
    return middle === undefined ? null : Math.round(middle);
  }

  const lower = sortedValues[mid - 1];
  const upper = sortedValues[mid];
  return lower === undefined || upper === undefined ? null : Math.round((lower + upper) / 2);
}

function buildVolumeSeries(conversations: readonly Conversation[], now: number): NamedSeries {
  // Bucket 0 is today; bucket TREND_DAYS - 1 is the oldest day still in
  // the window. Anything older falls outside it and is dropped.
  const counts = new Array<number>(TREND_DAYS).fill(0);

  for (const conversation of conversations) {
    for (const message of conversation.messages) {
      const age = now - Date.parse(message.sentAt);
      if (age < 0) continue;
      const bucket = Math.floor(age / DAY_MS);
      if (bucket >= TREND_DAYS) continue;
      counts[bucket] = (counts[bucket] ?? 0) + 1;
    }
  }

  const points: SeriesPoint[] = [];
  for (let bucket = TREND_DAYS - 1; bucket >= 0; bucket -= 1) {
    const label = new Date(now - bucket * DAY_MS).toISOString().slice(0, 10);
    points.push({ label, value: counts[bucket] ?? 0 });
  }

  return { name: 'Messages', tone: 'primary', points };
}

/**
 * The five overview figures, computed from the same `rows` the table
 * renders (never recomputed from scratch) plus the raw conversations
 * where a figure needs message-level detail no row carries.
 */
export function buildOverview(
  conversations: readonly Conversation[],
  rows: readonly ConversationRow[],
  flags: readonly SafetyFlag[],
  now: number,
): CommunicationsOverview {
  const rowById = new Map(rows.map((row) => [row.id, row] as const));

  // Only a patient message that actually got a doctor reply contributes a
  // gap. A message still waiting for one is already counted below, in
  // `unansweredOver48h` (via each row's own `status`); folding it in here
  // as a gap running to `now` would let the single oldest unanswered
  // thread drag the median by its own age — a fixture with a known answer
  // (120 minutes) pins this in communications.test.ts.
  const gaps: number[] = [];
  for (const conversation of conversations) {
    const patientId = rowById.get(conversation.id)?.patientId ?? null;
    if (patientId === null) continue;

    const { messages } = conversation;
    for (const [index, message] of messages.entries()) {
      if (message.authorId !== patientId) continue;
      const reply = messages.slice(index + 1).find((candidate) => candidate.authorId === ME_ID);
      if (reply === undefined) continue;
      gaps.push((Date.parse(reply.sentAt) - Date.parse(message.sentAt)) / 60_000);
    }
  }
  gaps.sort((a, b) => a - b);

  // Conversation-level, not flag-level: one thread with three flags counts
  // once toward the rate, the same way the Safety flags tab's queue length
  // and this rate must never be able to disagree.
  const flaggedConversationIds = new Set(flags.map((flag) => flag.conversationId));

  return {
    volume: buildVolumeSeries(conversations, now),
    medianResponseMinutes: medianOf(gaps),
    unansweredOver48h: rows.filter((row) => row.status === 'unanswered').length,
    activeConversations: rows.filter((row) => row.status === 'active').length,
    flagRate: rows.length === 0 ? 0 : flaggedConversationIds.size / rows.length,
  };
}

/**
 * `query` matches `doctorName` and `id` only — never `patientName`. This
 * is a privacy rule (§3.6), not a preference: searching a patient's name
 * must never be a way to find their thread.
 */
export function filterRows(
  rows: readonly ConversationRow[],
  filters: ConversationFilters,
): readonly ConversationRow[] {
  const query = filters.query.trim().toLowerCase();

  return rows.filter((row) => {
    if (filters.status !== 'all' && row.status !== filters.status) return false;
    if (filters.flagged === 'flagged' && row.flagCount === 0) return false;
    if (filters.flagged === 'unflagged' && row.flagCount > 0) return false;
    if (query === '') return true;

    return row.doctorName.toLowerCase().includes(query) || row.id.toLowerCase().includes(query);
  });
}

/** Sorts a copy; never mutates the rows the caller passed in. */
export function sortRows(
  rows: readonly ConversationRow[],
  sort: ConversationSort,
): readonly ConversationRow[] {
  const sorted = [...rows];
  switch (sort) {
    case 'recent':
      return sorted.sort((a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt));
    case 'oldest':
      return sorted.sort((a, b) => Date.parse(a.lastActivityAt) - Date.parse(b.lastActivityAt));
    case 'most-messages':
      return sorted.sort((a, b) => b.messageCount - a.messageCount);
    case 'most-flags':
      return sorted.sort((a, b) => b.flagCount - a.flagCount);
  }
}
