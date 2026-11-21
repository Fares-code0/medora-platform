import { describe, expect, it } from 'vitest';

import {
  ALL_FLAG_CATEGORIES,
  detectCategories,
  flagId,
  FLAG_CATEGORY_LABEL,
} from './flag-rules';

/**
 * Every detector is tested from both sides. No rule carries a negative
 * guard any more (spec §6.1, amended §6.2) — `emergency-language` never
 * gains one because a false negative there costs a patient, and
 * `prescription-solicitation` lost the drug-name/request-cue mechanism its
 * guards used to police, because a phrase-only positive set is precise
 * enough not to need one. "Negative" fixtures below still exist, but they
 * assert that ordinary messages simply fail to match any positive pattern
 * — not that a suppression rule cancels a match.
 */

describe('emergency language', () => {
  it('fires on a patient describing acute symptoms', () => {
    expect(detectCategories('I have severe chest pain right now')).toContain(
      'emergency-language',
    );
  });

  it('fires on "unconscious" even inside post-anaesthesia documentation — round-2 lesson', () => {
    // Round 1 added a negative guard (`post-op`, `in recovery`, ...) to
    // quiet this exact message as a false positive. Round 2 found that
    // guard then swallowed "unconscious patient, post-op, needs urgent
    // help" — a real emergency — because the same bare `post-op` match
    // cancelled it too. §6.1 resolves this by removing negative guards from
    // this category entirely: this message flagging again is the intended
    // behaviour, not a regression.
    expect(
      detectCategories('the patient is unconscious in recovery, all normal post-op'),
    ).toContain('emergency-language');
  });

  it('fires on the round-2 critical case: an unconscious patient described alongside routine terms', () => {
    expect(
      detectCategories('unconscious patient, post-op, needs urgent help'),
    ).toContain('emergency-language');
  });

  it('fires on acute symptoms even when the message also uses past-tense framing', () => {
    // "came back" was formerly a negative guard for this category; it is
    // gone, so a message like this — which round 1's guard would have
    // suppressed — now flags, consistent with "no negative guards at all".
    expect(
      detectCategories("My chest pain came back and I can't breathe, help now"),
    ).toContain('emergency-language');
  });

  it('fires on "overdosed" (past tense) — word-boundary bug fix', () => {
    // `/\boverdose\b/i` never matched this: the trailing `d` in "overdosed"
    // is part of the same word, so there is no boundary between "overdose"
    // and "d" for `\b` to land on. "overdose" was already in the
    // vocabulary; this fixes its most common inflection rather than adding
    // a new phrase, so it is not a §6.3 vocabulary widening.
    expect(detectCategories('I think I overdosed on my sleeping pills')).toContain(
      'emergency-language',
    );
  });

  describe('recall fixtures — round-4 review, 16 of 19 acute presentations missed', () => {
    // A reviewer tried 19 plausible acute presentations against the
    // original five-phrase list; 16 raised no flag. That is a recall gap
    // in the positive vocabulary, not a guard-cancellation bug — a
    // different failure mode from §6.1's, with the same victim. Every one
    // of the 13 messages the reviewer quoted is locked here.

    it.each([
      ['cardiac: heart attack', "I think I'm having a heart attack"],
      ['respiratory: not breathing (contraction)', "He's not breathing"],
      [
        "neurological: collapsed + won't wake up",
        "She just collapsed and won't wake up",
      ],
      ['neurological: seizure', "I'm having a seizure right now"],
      ['poisoning: swallowed a bottle of pills', 'I swallowed a whole bottle of pills'],
      [
        'poisoning: took too many pills',
        'I took too many of my pills by accident, more than prescribed',
      ],
      ['neurological: unresponsive', 'He is unresponsive after the fall'],
      [
        'respiratory: throat closing',
        "My throat is closing up, I can't swallow",
      ],
      [
        "haemorrhage: can't stop the bleeding",
        "I can't stop the bleeding from the cut on my arm",
      ],
      ['haemorrhage: bleeding a lot', "I'm bleeding a lot and feel dizzy and weak"],
      [
        'neurological: face drooping / stroke',
        "My face is drooping and I can't speak right, I think it's a stroke",
      ],
      [
        'self-harm: suicidal with a plan',
        "I'm suicidal and I have a plan to end my life tonight",
      ],
      ['paediatric: choking and turning blue', 'My child is choking and turning blue'],
    ])('fires on %s — "%s"', (_label, message) => {
      expect(detectCategories(message)).toContain('emergency-language');
    });
  });
});

describe('prescription solicitation', () => {
  // §6.2: this rule fires only on phrases that carry the solicitation
  // intent on their face. Controlled-drug names are not a trigger at all,
  // alone or in combination with a request verb — see the negatives below,
  // and the two documented accepted misses at the end of this block.

  it('fires on a request to obtain a controlled drug without a prescription', () => {
    expect(
      detectCategories('Can you send tramadol without a prescription please'),
    ).toContain('prescription-solicitation');
  });

  it('fires on "refill it early" as a standalone positive, with no drug name present', () => {
    expect(
      detectCategories('Please refill it early, I ran out sooner than expected.'),
    ).toContain('prescription-solicitation');
  });

  it('does not fire on "I need oxycodone ASAP, send it today no questions asked" — accepted miss, spec §6.2', () => {
    // Round 4 tightened "no questions asked" to require an adjacent
    // immediacy cue so this exact message would keep flagging. Round 5
    // broke that tightened version with four benign, non-drug clinic
    // messages (see the negatives below) — the immediacy window narrowed
    // the false-positive surface without ever requiring drug or request
    // content, so it never actually satisfied §6.2's "self-evidently a
    // solicitation out of context" bar. The phrase and its immediacy-cue
    // machinery are removed outright. Under §6.2 this message correctly
    // does not flag: nothing in it is self-evidently a solicitation out of
    // context on its own — a bare drug name plus urgency is already an
    // accepted miss above, and "no questions asked" no longer contributes
    // anything.
    expect(
      detectCategories('I need oxycodone ASAP, send it today no questions asked'),
    ).not.toContain('prescription-solicitation');
  });

  it('fires on a controlled-drug name that also trips the standalone "without a prescription" phrase', () => {
    expect(
      detectCategories('Send oxycodone without a prescription, already dispensed batch was stolen'),
    ).toContain('prescription-solicitation');
  });

  it('does not fire on a demand that persists past an offered legitimate channel — accepted miss, spec §6.2', () => {
    // This reads as suspicious to a human, but under §6.2's phrase-only
    // design it correctly does not flag: no phrase here is solicitation on
    // its face. "need it now anyway" was tried as a positive for exactly
    // this message and removed — it carries no drug-related content and
    // would fire on any impatient demand (see the next test). A rule that
    // guessed at intent from urgency plus a drug name is the same unsound
    // mechanism §6.2 replaced; this is a known, accepted miss, not a gap to
    // close by reintroducing it.
    expect(
      detectCategories('Can you send oxycodone? The refill is ready but I need it now anyway.'),
    ).not.toContain('prescription-solicitation');
  });

  it('does not fire on "need it now anyway" attached to a non-drug subject — proves the phrase is not drug-specific', () => {
    // If "need it now anyway" were still a positive, this message — about an
    // appointment, not a prescription — would flag too. It must not, which
    // is the reason that phrase was removed rather than kept as a narrow
    // fix for the case above.
    expect(
      detectCategories('I know the appointment is Friday but I need it now anyway.'),
    ).not.toContain('prescription-solicitation');
  });

  describe('round-4/5 misfires — phrases that failed the §6.2 self-evidence bar', () => {
    it('does not fire on "don\'t tell my doctor" attached to an unrelated disclosure — phrase removed outright', () => {
      // Zero drug or clinical vocabulary of its own; the sentence is about
      // alcohol and stress, not a prescription. Flagging it is a false
      // accusation, which §6.2 treats as the worse failure. The phrase was
      // removed rather than tightened — there is no adjacent cue that would
      // make it self-evidently a solicitation without reintroducing the
      // drug-name/context co-occurrence mechanism §6.2 already rejected.
      expect(
        detectCategories(
          "Don't tell my doctor, but I've been really stressed and drinking more than usual lately.",
        ),
      ).not.toContain('prescription-solicitation');
    });

    it('does not fire on "no questions asked" in a returns-policy sentence — round-4 negative, still holds', () => {
      expect(
        detectCategories(
          'You can return the unused CPAP supplies within 30 days, no questions asked.',
        ),
      ).not.toContain('prescription-solicitation');
    });

    it('does not fire on "no questions asked" in a re-test policy sentence — round-4 negative, still holds', () => {
      expect(
        detectCategories(
          'If the results come back abnormal, no questions asked, we will re-test.',
        ),
      ).not.toContain('prescription-solicitation');
    });

    // Round 5: the immediacy-cue-windowed version of "no questions asked"
    // (an immediacy word within 40 chars of the phrase, either order) was
    // broken by these four benign, non-drug clinic messages — every one
    // pairs an immediacy word with the phrase for a reason that has nothing
    // to do with a prescription, and all four were flagged as
    // prescription-solicitation before the phrase was removed outright.
    // Locked here so the phrase, windowed or not, cannot be reintroduced
    // silently.
    it('does not fire on an ID-check returns policy pairing "today" with "no questions asked"', () => {
      expect(
        detectCategories(
          'Please bring your ID today; returns are accepted with no questions asked.',
        ),
      ).not.toContain('prescription-solicitation');
    });

    it('does not fire on a refund policy pairing "immediately" with "no questions asked"', () => {
      expect(
        detectCategories(
          'We process refunds immediately, no questions asked, per store policy.',
        ),
      ).not.toContain('prescription-solicitation');
    });

    it('does not fire on an equipment-return policy pairing "right now" with "no questions asked"', () => {
      expect(
        detectCategories(
          'Right now our policy is no questions asked for equipment returns within a week.',
        ),
      ).not.toContain('prescription-solicitation');
    });

    it('does not fire on a supply-restock notice pairing "today" with "no questions asked"', () => {
      expect(
        detectCategories(
          'The clinic will restock your supplies today — no questions asked, per the standing order.',
        ),
      ).not.toContain('prescription-solicitation');
    });
  });

  it('does not fire on a bare drug-name mention with no solicitation phrase (dispensation note)', () => {
    expect(detectCategories('diazepam 5mg dispensed')).not.toContain(
      'prescription-solicitation',
    );
  });

  it('does not fire on a routine dosage instruction naming a controlled drug', () => {
    expect(
      detectCategories('Increase tramadol to 50mg twice daily and reassess in a week.'),
    ).not.toContain('prescription-solicitation');
  });

  it('does not fire on a pharmacy refill-ready notice naming no controlled drug', () => {
    expect(
      detectCategories('Your atorvastatin refill is ready at the pharmacy.'),
    ).not.toContain('prescription-solicitation');
  });

  it('does not fire on a clinician confirming a dose was administered — round-3 false positive under the old mechanism', () => {
    // Old mechanism: "oxycodone" + "confirm"-adjacent phrasing read as a
    // request cue and flagged this as drug-seeking. It is routine clinical
    // logistics attached to a named clinician; a false accusation here is
    // the worse failure §6.2 accepts a missed phrasing to avoid.
    expect(
      detectCategories('Can you confirm the oxycodone dose was administered at 2pm?'),
    ).not.toContain('prescription-solicitation');
  });

  it('does not fire on a routine report request naming a controlled drug', () => {
    expect(
      detectCategories('Send the oxycodone inventory report by Friday.'),
    ).not.toContain('prescription-solicitation');
  });

  it('does not fire on a clinical-protocol note naming a controlled drug', () => {
    expect(
      detectCategories('The patient will need oxycodone for post-op pain management per protocol.'),
    ).not.toContain('prescription-solicitation');
  });

  it('does not fire on "I want alprazolam today" — documented accepted miss, spec §6.2', () => {
    // §6.2, by the user's decision: drug names are no longer a trigger, so
    // a bare demand naming one and no explicit-intent phrase does not flag.
    // This is the stated, accepted limit of the rule — not a bug to later
    // "fix" by reintroducing a drug-name or co-occurrence trigger, which is
    // exactly the mechanism three review rounds found unsound.
    expect(detectCategories('I want alprazolam today')).not.toContain(
      'prescription-solicitation',
    );
  });

  it('does not fire on "oxycodone. now." — documented accepted miss, spec §6.2', () => {
    // Same accepted limit as above: a bare drug name plus urgency, with no
    // explicit-intent phrase, is not enough to flag under §6.2.
    expect(detectCategories('oxycodone. now.')).not.toContain('prescription-solicitation');
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

  it('does not fire on an apologetic "regret this", only the threat reading', () => {
    expect(
      detectCategories(
        'We regret this delay and appreciate your patience while we reschedule.',
      ),
    ).not.toContain('harassment');
  });

  it('fires on the threat form of "regret this" even without another abusive phrase', () => {
    expect(detectCategories('If you do not comply, you will regret this.')).toContain(
      'harassment',
    );
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

describe('Task 3 seed messages (must keep tripping their rule)', () => {
  // Task 3 seeds these three messages into the shared conversation corpus.
  // Locked here so a later rule change to this file cannot silently stop
  // any of them from being flagged.
  it('still flags an acute-symptom message as emergency-language', () => {
    expect(
      detectCategories('I have severe chest pain right now and it is not going away.'),
    ).toContain('emergency-language');
  });

  it('still flags a without-prescription request as prescription-solicitation', () => {
    expect(
      detectCategories('Could you send tramadol without a prescription? The pain is bad.'),
    ).toContain('prescription-solicitation');
  });

  it('still flags a pasted record identifier as phi-wrong-channel', () => {
    expect(
      detectCategories('Cross-check against PT-1004 before the panel on Friday.'),
    ).toContain('phi-wrong-channel');
  });
});

describe('FLAG_CATEGORY_LABEL', () => {
  it('labels every category', () => {
    for (const category of ALL_FLAG_CATEGORIES) {
      expect(FLAG_CATEGORY_LABEL[category].length).toBeGreaterThan(0);
    }
  });
});
