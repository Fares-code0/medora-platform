import { describe, expect, it } from 'vitest';

import {
  detectRedFlag,
  ESCALATION_MESSAGE,
  normalizeForRedFlags,
  RED_FLAG_LIST_SIZES,
  type RedFlagCategory,
} from './patient-ai-red-flags';

/**
 * The deterministic red-flag pre-check (ADR-050).
 *
 * The positive cases are the floor the clinical sign-off will review; the
 * negative cases pin that ordinary questions are not turned into
 * emergencies. Negation is not parsed on purpose (conservative), and that
 * choice is pinned too.
 */

const POSITIVE: readonly (readonly [string, RedFlagCategory])[] = [
  // English
  ['I have crushing chest pain since an hour', 'chest_pain'],
  ['Pain in my chest and my left arm', 'chest_pain'],
  ['I think I am having a HEART ATTACK', 'chest_pain'],
  ['my dad’s face is drooping and he has slurred speech', 'stroke'],
  ['Sudden weakness on one side', 'stroke'],
  ["I can't breathe", 'breathing'],
  ['cant breathe properly', 'breathing'],
  ['my child is choking', 'breathing'],
  ['her lips are turning blue', 'breathing'],
  ['I feel suicidal', 'suicidal'],
  ['I want to kill myself', 'suicidal'],
  ['sometimes I want to end my life', 'suicidal'],
  ['I want to die', 'suicidal'],
  ['thinking about self-harm', 'suicidal'],
  ['the cut is bleeding heavily', 'bleeding'],
  ["bleeding that won't stop", 'bleeding'],
  ['I am vomiting blood', 'bleeding'],
  ['anaphylaxis after peanuts', 'anaphylaxis'],
  ['my throat is swelling up', 'anaphylaxis'],
  ['he passed out and is unresponsive', 'unconscious'],
  ['she is having a seizure', 'unconscious'],
  ['I took an overdose of pills', 'poisoning'],
  // Arabic — plain, with diacritics, with alef / taa-marbuta variants, with prefixes
  ['عندي ألم في الصدر', 'chest_pain'],
  ['عندي أَلَمٌ فِي الصَّدْرِ', 'chest_pain'],
  ['وألم بالصدر من الصبح', 'chest_pain'],
  ['اعتقد انها نوبه قلبيه', 'chest_pain'],
  ['أبي عنده سكتة دماغية', 'stroke'],
  ['ميلان في الوجه وصعوبة في الكلام', 'stroke'],
  ['لا أستطيع التنفس', 'breathing'],
  ['مش قادر اتنفس', 'breathing'],
  ['ما اقدر اتنفس', 'breathing'],
  ['أفكر في الانتحار', 'suicidal'],
  ['أريد أن أموت', 'suicidal'],
  ['اريد ان اموت', 'suicidal'],
  ['بدي موت', 'suicidal'],
  ['نزيف شديد من الجرح', 'bleeding'],
  ['حساسية شديدة وتورم في اللسان', 'anaphylaxis'],
  ['فقد الوعي فجأة', 'unconscious'],
  ['أُغْمِيَ عليه', 'unconscious'],
  ['أخذ جرعة زائدة', 'poisoning'],
  ['ابني عنده تسمم', 'poisoning'],
];

const NEGATIVE: readonly string[] = [
  'How do I prepare for my blood test tomorrow?',
  'What does HbA1c mean?',
  'Can I reschedule my appointment to next week?',
  'Is it normal to feel tired after a vaccine?',
  'كيف أستعد لموعدي القادم؟',
  'ما معنى تحليل السكر التراكمي؟',
  'متى تظهر حالة التحليل في التطبيق؟',
];

describe('detectRedFlag — positives (en + ar)', () => {
  it.each(POSITIVE)('escalates %j as %s', (message, category) => {
    expect(detectRedFlag(message)).toEqual({ category });
  });
});

describe('detectRedFlag — negatives', () => {
  it.each(NEGATIVE)('does not escalate %j', (message) => {
    expect(detectRedFlag(message)).toBeNull();
  });

  it('is conservative: negation is not parsed, so "no chest pain" still escalates', () => {
    expect(detectRedFlag('I have no chest pain')).toEqual({ category: 'chest_pain' });
  });
});

describe('normalizeForRedFlags', () => {
  it('strips Arabic diacritics and tatweel and folds alef, yaa, taa marbuta, hamza seats', () => {
    expect(normalizeForRedFlags('أَلَـمٌ')).toBe(' الم ');
    expect(normalizeForRedFlags('إسعاف آمن ٱلله')).toBe(' اسعاف امن الله ');
    expect(normalizeForRedFlags('مستشفى قلبية')).toBe(' مستشفي قلبيه ');
    expect(normalizeForRedFlags('مؤلم زائد')).toBe(' مولم زايد ');
  });

  it('lower-cases, unifies apostrophes and turns punctuation into spaces', () => {
    expect(normalizeForRedFlags('CAN’T   Breathe!!!')).toBe(" can't breathe ");
  });
});

describe('the lists themselves', () => {
  it('covers every category in both languages', () => {
    for (const [category, sizes] of Object.entries(RED_FLAG_LIST_SIZES)) {
      expect(sizes.en, `${category} en`).toBeGreaterThan(0);
      expect(sizes.ar, `${category} ar`).toBeGreaterThan(0);
    }
  });

  it('has escalation copy in both locales that names emergency services and the Emergency screen, and no phone number', () => {
    expect(ESCALATION_MESSAGE.en).toMatch(/emergency services/);
    expect(ESCALATION_MESSAGE.en).toMatch(/Emergency screen/);
    expect(ESCALATION_MESSAGE.ar).toContain('الطوارئ');
    expect(ESCALATION_MESSAGE.ar).toContain('شاشة الطوارئ');
    for (const text of Object.values(ESCALATION_MESSAGE)) {
      expect(text).not.toMatch(/\d{2,}/);
    }
  });
});
