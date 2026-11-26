/**
 * The deterministic red-flag pre-check of the patient assistant (ADR-050).
 *
 * Runs on every patient message **before** the model is called. A match
 * means the server answers with a fixed escalation message (contact local
 * emergency services / the app's Emergency screen) and the gateway is never
 * consulted — so an emergency is never left to a model's judgement, and the
 * escalation still works on a deployment with no provider configured.
 *
 * ## Conservative by construction
 *
 * The lists err towards escalating. A false positive costs the patient one
 * redundant safety message; a false negative leaves a person describing an
 * emergency talking to a chatbot. Negation is deliberately **not** parsed:
 * "no chest pain" escalates too.
 *
 * ## Known false-negative limits (documented in ADR-050)
 *
 * Keyword matching cannot catch: misspellings beyond the normalisations
 * below, dialect phrasings not listed, Arabizi / transliterated Arabic
 * ("msh 2ader atnafas"), other languages, emergencies described indirectly
 * ("my dad went grey and collapsed on the floor"), or a split across two
 * messages. The pre-check is a floor, not a triage system; the copy and the
 * phrase lists both await clinical sign-off.
 */

/** The category of the first match. Never logged or audited — see the service. */
export type RedFlagCategory =
  | 'chest_pain'
  | 'stroke'
  | 'breathing'
  | 'suicidal'
  | 'bleeding'
  | 'anaphylaxis'
  | 'unconscious'
  | 'poisoning';

export interface RedFlagMatch {
  readonly category: RedFlagCategory;
}

/** Arabic harakat, superscript alef, Quranic marks and tatweel. */
const ARABIC_MARKS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;

/**
 * Lower-cases, folds Arabic spelling variants and collapses punctuation.
 *
 * Arabic: diacritics and tatweel removed; أ إ آ ٱ → ا; ى → ي; ة → ه;
 * ؤ → و; ئ → ي. Applied identically to the phrase lists, so a list may be
 * written in ordinary spelling.
 */
export function normalizeForRedFlags(text: string): string {
  return ` ${text
    .normalize('NFKC')
    .toLowerCase()
    .replace(ARABIC_MARKS, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[’‘`´]/g, "'")
    // Everything that is not a letter, a digit or an apostrophe separates words.
    .replace(/[^\p{L}\p{N}']+/gu, ' ')
    .trim()} `;
}

/** English patterns, matched against the normalised text. */
const ENGLISH: Readonly<Record<RedFlagCategory, readonly RegExp[]>> = {
  chest_pain: [
    /\bchest (pain|pains|tightness|pressure|hurts?|is hurting)\b/,
    /\bpain (in|on) (my |the )?chest\b/,
    /\bcrushing (chest )?pain\b/,
    /\bheart attack\b/,
  ],
  stroke: [
    /\bstroke\b/,
    /\bface (is )?(drooping|droops|dropped|numb)\b/,
    /\b(drooping|droopy) (face|mouth)\b/,
    /\bslurr(ed|ing) (speech|words)\b/,
    /\bsudden (weakness|numbness|confusion)\b/,
    /\b(can'?t|cannot|unable to) (move|feel) (my )?(arm|leg|face|one side)\b/,
  ],
  breathing: [
    /\b(can'?t|cannot|unable to|struggling to|hard to|difficult to) breathe?\b/,
    /\b(severe|extreme|sudden) (shortness of breath|breathlessness|breathing difficulty)\b/,
    /\bnot breathing\b/,
    /\bchoking\b/,
    /\bgasping\b/,
    /\b(lips|face) (are |is )?(turning )?blue\b/,
  ],
  suicidal: [
    /\bsuicid/,
    /\bkill(ing)? myself\b/,
    /\bend (my|it all|my own) life\b/,
    /\bend it all\b/,
    /\btake my (own )?life\b/,
    /\bwant(ing)? to die\b/,
    /\bself[ ]?harm/,
    /\bhurt(ing)? myself\b/,
    /\bbetter off dead\b/,
  ],
  bleeding: [
    /\b(severe|heavy|heavily|uncontrolled|massive|a lot of) bleeding\b/,
    /\bbleeding (heavily|a lot|badly|won'?t stop|will not stop|that won'?t stop|nonstop)\b/,
    /\b(won'?t|will not|can'?t) stop (the )?bleeding\b/,
    /\b(vomiting|throwing up|coughing up|coughing) blood\b/,
  ],
  anaphylaxis: [
    /\banaphyla/,
    /\b(severe|bad) allergic reaction\b/,
    /\b(throat|tongue|lips?) (is |are )?(swelling|swollen|closing)( up)?\b/,
    /\bswelling (of|in) (my |the )?(throat|tongue|lips|mouth)\b/,
  ],
  unconscious: [
    /\bunconscious\b/,
    /\bunresponsive\b/,
    /\bpassed out\b/,
    /\bfainted\b/,
    /\bcollapsed\b/,
    /\bseizure/,
    /\bconvuls/,
  ],
  poisoning: [/\boverdos/, /\bpoison/, /\bswallowed (bleach|pills|detergent|battery)/],
};

/** Arabic phrases (MSA + common Gulf / Levantine / Egyptian forms), normalised at load. */
const ARABIC_SOURCE: Readonly<Record<RedFlagCategory, readonly string[]>> = {
  chest_pain: [
    'ألم في الصدر',
    'ألم بالصدر',
    'ألم صدر',
    'ألم في صدري',
    'وجع في الصدر',
    'وجع بالصدر',
    'وجع صدري',
    'وجع في صدري',
    'ضيق في الصدر',
    'نوبة قلبية',
    'جلطة قلبية',
    'أزمة قلبية',
  ],
  stroke: [
    'جلطة دماغية',
    'جلطة في الدماغ',
    'سكتة دماغية',
    'شلل مفاجئ',
    'تنميل مفاجئ',
    'ضعف مفاجئ',
    'ثقل في اللسان',
    'صعوبة في الكلام',
    'لا أستطيع الكلام',
    'ميلان الوجه',
    'ميلان في الوجه',
    'اعوجاج الوجه',
    'ارتخاء الوجه',
  ],
  breathing: [
    'لا أستطيع التنفس',
    'لا اقدر اتنفس',
    'ما اقدر اتنفس',
    'ما أقدر أتنفس',
    'مش قادر اتنفس',
    'مش قادرة اتنفس',
    'مو قادر اتنفس',
    'مش عارف اتنفس',
    'صعوبة شديدة في التنفس',
    'ضيق تنفس شديد',
    'ضيق شديد في التنفس',
    'اختناق',
    'لا يتنفس',
    'ما يتنفس',
    'مش بيتنفس',
  ],
  suicidal: [
    'انتحار',
    'انتحر',
    'أقتل نفسي',
    'اقتل حالي',
    'أنهي حياتي',
    'إنهاء حياتي',
    'أريد أن أموت',
    'أبغى أموت',
    'ابي اموت',
    'عايز أموت',
    'عاوز اموت',
    'بدي موت',
    'بدي اموت',
    'أؤذي نفسي',
    'إيذاء نفسي',
    'أذية نفسي',
  ],
  bleeding: [
    'نزيف شديد',
    'نزيف حاد',
    'نزيف قوي',
    'نزيف لا يتوقف',
    'نزيف ما يوقف',
    'نزيف مش بيوقف',
    'تقيؤ دم',
    'استفراغ دم',
    'ترجيع دم',
    'سعال دم',
    'كحة دم',
  ],
  anaphylaxis: [
    'حساسية شديدة',
    'صدمة تحسسية',
    'تورم الحلق',
    'تورم في الحلق',
    'تورم اللسان',
    'تورم في اللسان',
    'تورم الشفايف',
    'انتفاخ الحلق',
    'انتفاخ اللسان',
  ],
  unconscious: [
    'فقدان الوعي',
    'فقد الوعي',
    'فاقد الوعي',
    'إغماء',
    'أغمي عليه',
    'أغمي علي',
    'اغمى عليه',
    'تشنجات',
    'تشنج',
    'نوبة صرع',
    'لا يستجيب',
  ],
  poisoning: ['تسمم', 'جرعة زائدة', 'جرعه زايده', 'شرب كلور', 'بلع حبوب'],
};

const ARABIC: Readonly<Record<RedFlagCategory, readonly string[]>> = Object.fromEntries(
  Object.entries(ARABIC_SOURCE).map(([category, phrases]) => [
    category,
    phrases.map((phrase) => normalizeForRedFlags(phrase).trim()),
  ]),
) as unknown as Record<RedFlagCategory, readonly string[]>;

const CATEGORIES = Object.keys(ENGLISH) as RedFlagCategory[];

/**
 * The first red-flag category the message hits, or `null`.
 *
 * Arabic phrases match as substrings (no word boundary) on purpose: Arabic
 * attaches prefixes (و، ف، ب، ل، ال) to the word, so a boundary-anchored
 * match would miss "وألم في الصدر". Over-matching is the safe direction.
 */
export function detectRedFlag(message: string): RedFlagMatch | null {
  const text = normalizeForRedFlags(message);

  for (const category of CATEGORIES) {
    if (ENGLISH[category].some((pattern) => pattern.test(text))) return { category };
    if (ARABIC[category].some((phrase) => text.includes(phrase))) return { category };
  }

  return null;
}

/** Exposed for the spec: the sizes of the lists, so a shrink is visible. */
export const RED_FLAG_LIST_SIZES = Object.fromEntries(
  CATEGORIES.map((category) => [
    category,
    { en: ENGLISH[category].length, ar: ARABIC[category].length },
  ]),
) as unknown as Readonly<Record<RedFlagCategory, { readonly en: number; readonly ar: number }>>;

/**
 * The fixed escalation answer. No phone number is given: emergency numbers
 * differ by country and inventing one is worse than none. Pending clinical
 * sign-off (ADR-050).
 */
export const ESCALATION_MESSAGE: Readonly<Record<'en' | 'ar', string>> = {
  en: [
    'What you describe may be a medical emergency.',
    'Please contact your local emergency services now, or open the Emergency screen in this app.',
    'If you can, ask someone nearby to stay with you.',
    'This assistant cannot help in an emergency and has not assessed your message.',
  ].join(' '),
  ar: [
    'ما تصفه قد يكون حالة طبية طارئة.',
    'يُرجى الاتصال بخدمات الطوارئ المحلية الآن، أو فتح شاشة الطوارئ في هذا التطبيق.',
    'إن أمكن، اطلب من شخص قريب منك أن يبقى معك.',
    'لا يستطيع هذا المساعد المساعدة في حالات الطوارئ، ولم يقم بتقييم رسالتك.',
  ].join(' '),
};
