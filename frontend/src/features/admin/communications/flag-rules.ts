/**
 * Safety-flag detection (ADM-06 · UX §3.6, amended §6.1, amended §6.2,
 * amended §6.3).
 *
 * Deterministic rules over message text. This is NOT a classifier and must
 * not be described as one in UI copy — it is a fixed set of patterns whose
 * behaviour a reviewer can read in one screen and predict exactly.
 *
 * **What widening this file can and cannot buy (§6.3) — read this before
 * adding a phrase.** This is a keyword heuristic, not a classifier, and its
 * recall on phrasing it has not already been given is measured, not
 * assumed, to be poor: a review round widened `emergency-language` until it
 * caught all 13 phrasings the previous reviewer had named, and the next
 * reviewer then tried 22 fresh emergency wordings across the same
 * categories — exactly 1 matched. Adding those 22 (or the next reviewer's
 * next batch) would repeat that cycle, not end it; a fixed phrase list
 * cannot cover natural language, and this is the third round of evidence
 * saying so, not the first. That is acceptable specifically because this
 * queue is retrospective *governance* (§3.6), not a triage path — a message
 * that fails to flag is still sitting unflagged in the doctor's own inbox,
 * in front of the clinician it was actually sent to, and that is where an
 * emergency is actually seen and acted on. What a missed flag costs here is
 * an administrator not later auditing that thread, never a delayed
 * response to the patient. **So: the next person tempted to close a recall
 * gap by widening a vocabulary should know up front that another
 * hand-picked batch of phrases buys another narrow, falsifiable win, not
 * coverage** — the Safety flags tab carries the same caveat on screen for
 * the same reason, so an administrator never mistakes this queue for a
 * safety net.
 *
 * **No rule in this file carries a negative guard.** That started as a
 * scoped decision (§6.1: a suppression mechanism keyed on "any negative
 * pattern anywhere in the message" is unsound in both directions, so
 * `emergency-language` dropped its guards outright) and became total when
 * `prescription-solicitation` — the last rule still using them — turned out
 * to need the same fix for a different reason (§6.2): its guards were
 * separately defeatable by dropping a routine phrase into a live demand.
 * `harassment` and `phi-wrong-channel` never needed guards in the first
 * place. With no rule using the mechanism, the `negative` field itself is
 * gone from `Rule` rather than kept as a hypothetical extension point —
 * an unused field is exactly the kind of thing this project treats as a
 * finding, not a convenience.
 *
 * `prescription-solicitation` also lost its drug-name/request-cue
 * co-occurrence trigger (§6.2): naming a controlled drug is ordinary
 * clinical vocabulary, and "does this message express solicitation intent"
 * is not a fact regex can extract from a noun plus a verb. The rule now
 * fires only on phrases that are self-evidently a solicitation on their
 * face — see that rule's own comment for the accepted cost.
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
  /** Any one of these matching alone is sufficient to trip the rule. */
  readonly positive: readonly RegExp[];
}

// Declared out of ALL_FLAG_CATEGORIES order on purpose — see
// detectCategories' re-sort below. If RULES happened to already be in
// ALL_FLAG_CATEGORIES order, the re-sort step would be untestable: any
// mutation deleting it would still pass, because Array#filter preserves
// declaration order regardless of which elements match.
const RULES: readonly Rule[] = [
  {
    category: 'emergency-language',
    // Widened after a fourth review round found the vocabulary itself was
    // the recall gap, not the (already-removed) suppression logic: of 19
    // plausible acute presentations tried against the original five
    // phrases, 16 raised no flag — "he's not breathing", "she just
    // collapsed and won't wake up", "I'm having a seizure right now", "I
    // swallowed a whole bottle of pills", "my face is drooping ... I think
    // it's a stroke", "I'm suicidal and I have a plan to end my life
    // tonight", among others. That is a false negative caused by an
    // under-broad positive list, a different failure mode from the
    // cancelling-guard bug §6.1 fixed, but with the same victim. Grouped by
    // presentation class so a future gap is easy to place and close in the
    // right group, not a reason to expect the grouping to be exhaustive.
    positive: [
      // cardiac
      /\bchest pain\b/i,
      /\bchest pressure\b/i,
      /\bheart attack\b/i,
      // respiratory
      /\bcan(?:'|no)?t breathe\b/i,
      /\b(?:not|isn'?t|ain'?t) breathing\b/i,
      /\bstopped breathing\b/i,
      /\bthroat (?:is )?closing\b/i,
      /\bcan(?:'|no)?t swallow\b/i,
      /\bchoking\b/i,
      /\bturning blue\b/i,
      // neurological
      /\bstroke\b/i,
      /\bface (?:is )?droop(?:ing)?\b/i,
      /\bslurred speech\b/i,
      /\bseizure\b/i,
      /\bunresponsive\b/i,
      /\bunconscious\b/i,
      /\bwon'?t wake(?: up)?\b/i,
      /\bcollapsed\b/i,
      // haemorrhage
      /\bbleeding heavily\b/i,
      /\bbleeding a lot\b/i,
      /\bcan(?:'|no)?t stop (?:the )?bleeding\b/i,
      // poisoning / overdose
      // `\boverdose\b` alone never matches "overdosed" — the trailing `d`
      // is inside the same word, so there is no boundary between "overdose"
      // and "d" for `\b` to land on. Fixed to cover the past-tense form,
      // which is how this word actually appears in a patient message. This
      // corrects an existing pattern's most common inflection; it is not a
      // vocabulary widening under the §6.3 policy above.
      /\boverdosed?\b/i,
      /\bswallowed (?:a |an )?(?:whole )?bottle of pills\b/i,
      /\btook too many (?:of my )?pills\b/i,
      // self-harm
      /\bsuicidal\b/i,
      /\bend my life\b/i,
      /\bkill myself\b/i,
    ],
    // NO SUPPRESSION LOGIC — DO NOT ADD ONE. This is the §6.1 decision, not
    // an oversight. Round 1 added a negative guard here (`post-op`, `in
    // recovery`, `came back`, ...) to quiet three false positives; round 2
    // found the guard then swallowed a real one — "unconscious patient,
    // post-op, needs urgent help" raised no flag, because the bare
    // `post-op` match cancelled it. In a safety queue a false negative
    // costs a patient; a false positive costs a reviewer ten seconds
    // reading a message that turns out to be routine. That asymmetry means
    // this category should over-flag, not under-flag. Any topical guard
    // added here — for this rule specifically, whatever mechanism carries
    // it — will, sooner or later, cancel a real emergency the same way
    // `post-op` did. Widening the vocabulary above raises the same
    // over-flag risk on ordinary clinical chat (e.g. "choking on emotion",
    // a documentation note using "unresponsive to treatment") — that is the
    // accepted trade this category always makes, not a new one.
  },
  {
    category: 'harassment',
    positive: [
      /\byou are an? (?:idiot|fool|liar)\b/i,
      /\bshut up\b/i,
      // Only the threat reading — "you'll regret this", "you will regret
      // this", "I'll make you regret this" — not the apologetic "we regret
      // this [delay/inconvenience]", which is ordinary customer-service
      // language and shares no subject/auxiliary with the threat form. This
      // distinction is carried entirely by the positive pattern's shape, so
      // no negative guard is needed here.
      /\b(?:you'?ll|you will|make you) regret this\b/i,
      /\bincompetent\b/i,
    ],
  },
  {
    category: 'prescription-solicitation',
    // Phrase-only positives (§6.2). Every pattern here is a phrase a reader
    // would call self-evidently a solicitation on its own, with no
    // surrounding context needed to disambiguate it — which is exactly why
    // no negative guard is needed either: a phrase this explicit is not
    // something a routine sentence produces by accident.
    //
    // Controlled-drug names are deliberately NOT a trigger, alone or in
    // combination with a request verb. That co-occurrence mechanism
    // (drug name + "send"/"need"/"can you"/...) was the round-1/round-2
    // design: it flagged "Can you confirm the oxycodone dose was
    // administered at 2pm?" as drug-seeking while missing "I want
    // alprazolam today" and "oxycodone. now." outright, because neither
    // uses a listed cue verb — miscalibrated in both directions at once.
    // The accepted cost is that both of those last two now go unflagged;
    // see flag-rules.test.ts for that asserted as intended behaviour.
    // "no questions asked" — including the round-4 immediacy-cue-window
    // tightening that used to live here ("asap"/"today"/"right now"/
    // "immediately" within 40 chars of the phrase, either order) — is
    // removed outright, not tightened again. A fifth review round broke
    // that narrowed version with four benign, non-drug clinic messages, all
    // flagged as prescription-solicitation: an ID-check returns policy, a
    // refund policy, an equipment-return policy, and a supply-restock
    // notice, each pairing an immediacy word with the phrase for reasons
    // that have nothing to do with a prescription. The immediacy window
    // narrowed the false-positive surface but never required drug or
    // request content, which is what §6.2's "self-evidently a solicitation
    // out of context" bar actually demands — so no adjacency window fixes
    // it; any window still lets an unrelated policy sentence supply both
    // halves. The accepted cost, stated rather than discovered later: "I
    // need oxycodone ASAP, send it today no questions asked" no longer
    // flags. That is correct under §6.2 — nothing in that message is
    // self-evidently a solicitation out of context either, a bare drug name
    // plus urgency already being an accepted miss above — and it is locked
    // in flag-rules.test.ts as a documented accepted miss alongside two of
    // the four benign messages that broke the tightened version, so the
    // phrase cannot be reintroduced silently.
    positive: [
      /\bwithout a prescription\b/i,
      /\brefill (?:it )?early\b/i,
      // "don't tell my doctor" was removed outright rather than tightened:
      // unlike "no questions asked" it has zero drug or clinical vocabulary
      // of its own ("Don't tell my doctor, but I've been drinking more than
      // usual lately" is about alcohol, not a prescription), so there is no
      // adjacent cue that would make it self-evidently a solicitation
      // without reintroducing the drug-name/context co-occurrence mechanism
      // §6.2 rejected. No required positive depends on this phrase, so
      // removing it costs nothing already promised elsewhere in this file.
      //
      // "need it now anyway" was tried here for the round-3 defeatable-
      // negative case (`Can you send oxycodone? The refill is ready but I
      // need it now anyway.`) and removed again: the phrase carries no
      // drug-solicitation content on its face — it is generic impatience
      // that attaches to any subject ("I know the appointment is Friday but
      // I need it now anyway"). Adding it broke §6.2's own test —
      // self-evidently a solicitation *out of context* — for the sake of
      // one message. That message is now a documented accepted miss; see
      // flag-rules.test.ts.
    ],
  },
  {
    category: 'phi-wrong-channel',
    positive: [
      /\bPT-\d{4}\b/,
      /\bMRN[:\s-]?\d+/i,
      // Trade-off, not an oversight: an unformatted 11+ digit run also
      // matches an international phone number or an invoice number with no
      // PHI content, so this can false-positive against the module's own
      // premise. Kept anyway — a bare 11+ digit run is otherwise rare in
      // ordinary clinical chat, a phi-wrong-channel flag is cheap for a
      // reviewer to dismiss, and the alternative (dropping the pattern)
      // risks missing a pasted identifier with no MRN: prefix.
      /\b\d{11,}\b/,
    ],
  },
];

/** Categories this message trips, ordered by `ALL_FLAG_CATEGORIES`. */
export function detectCategories(body: string): readonly FlagCategory[] {
  const hits = RULES.filter((rule) => rule.positive.some((pattern) => pattern.test(body))).map(
    (rule) => rule.category,
  );

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
