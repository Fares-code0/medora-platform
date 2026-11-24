import fs from 'node:fs';
import path from 'node:path';

import { catalogues } from '@/i18n';

/**
 * The clinical and legal sign-off gate — checklist W-10.
 *
 * ── What this is ────────────────────────────────────────────────────
 *
 * `docs/SIGNOFF.md` is a register, and a register nobody can check is a
 * formality. These tests read its table and hold the constraints §2
 * records for every item that is **not** signed: the emergency content
 * carries no treatment instruction, the app has no AI surface, and a
 * record's release state is read rather than derived.
 *
 * The lever is the document itself. Replace `⛔ not signed` in the
 * *Signed by* column with a name and the corresponding constraint stops
 * being a build gate — which is the point, because a signature is a
 * person saying they read the artefacts, and the code should then be
 * free to do what they approved. There is no flag anywhere else.
 *
 * ── Why a deny-list, and why these words ────────────────────────────
 *
 * `guidance.ts` already tells its reader that a treatment instruction
 * belongs in front of a clinical owner first. A docblock is advice; this
 * is the part that notices. The list is the vocabulary of first-aid
 * *instruction* — depth, dose, manoeuvre, position — rather than of
 * emergency *recognition*, which is what the bundled copy is allowed to
 * be and is. It will not catch every phrasing a determined author could
 * invent, and it does not need to: it catches the ordinary case, which
 * is someone adding a genuinely well-meant CPR step to a file they did
 * not realise was gated.
 *
 * In the idiom of `store-privacy.test.ts` and `a11y-audit.test.ts`: the
 * tests do not check the prose, they check the facts the document
 * asserts, and each failure names the item it re-opens.
 */

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src');
const REGISTER = path.join(ROOT, 'docs', 'SIGNOFF.md');

const register = fs.readFileSync(REGISTER, 'utf8');

/** The register's own marker for "nobody has signed this". */
const UNSIGNED = '⛔ not signed';

/**
 * Reads one row of §1 by its item name and returns whether it is signed.
 *
 * A row that cannot be found is a failure rather than a default: a
 * renamed item must not silently release the constraint that was
 * holding for it.
 */
function isSigned(item: string): boolean {
  const row = register
    .split('\n')
    .find((line) => line.startsWith('|') && line.includes(`| ${item} |`));

  if (row === undefined) {
    throw new Error(
      `docs/SIGNOFF.md §1 has no row for "${item}". ` +
        'Renaming an item hides the constraint that was holding for it — ' +
        'rename it here too, deliberately.',
    );
  }

  return !row.includes(UNSIGNED);
}

function sourcesUnder(dir: string, match: RegExp): { file: string; source: string }[] {
  if (!fs.existsSync(dir)) return [];
  const files: string[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (match.test(full) && !/\.test\.tsx?$/.test(entry.name)) files.push(full);
    }
  };
  walk(dir);
  return files.map((file) => ({
    file: path.relative(SRC, file),
    source: fs.readFileSync(file, 'utf8'),
  }));
}

describe('the register exists and is readable as a gate', () => {
  it('states plainly that nothing has shipped on it', () => {
    // The one claim the whole file rests on. If a build is ever cut
    // against a register that says nothing about its own status, the
    // reader has no way to tell an empty table from an approved one.
    expect(register).toContain('No build ships to a store');
  });

  it('names every artefact it claims to cover, and each one exists', () => {
    // A register that lists a file which was renamed or deleted is
    // asking someone to sign off on something they cannot read.
    const claimed = [...register.matchAll(/`(src\/[^`]+\.tsx?)`/g)]
      .map((match) => match[1])
      .filter((file): file is string => file !== undefined);

    expect(claimed.length).toBeGreaterThan(0);

    const missing = claimed.filter((file) => !fs.existsSync(path.join(ROOT, file)));
    expect(missing).toEqual([]);
  });

  it('keeps the pointer in guidance.ts true', () => {
    // `guidance.ts` has told its reader to take a treatment instruction
    // to "the clinical owner named in docs/SIGNOFF.md" since the
    // Emergency phase landed, and for that whole time the file did not
    // exist. This is the assertion that it does.
    const guidance = fs.readFileSync(
      path.join(SRC, 'features', 'emergency', 'content', 'guidance.ts'),
      'utf8',
    );

    expect(guidance).toContain('docs/SIGNOFF.md');
    expect(fs.existsSync(REGISTER)).toBe(true);
  });
});

describe('item 1 — Emergency copy (N-07)', () => {
  /**
   * Instruction, not recognition. "Chest pain" is a red flag and is
   * allowed; "begin compressions" is a treatment step and is not.
   */
  const TREATMENT_INSTRUCTION = [
    'cpr',
    'compression',
    'rescue breath',
    'mouth-to-mouth',
    'recovery position',
    'heimlich',
    'abdominal thrust',
    'back blow',
    'tourniquet',
    'apply pressure',
    'elevate the',
    'epinephrine',
    'epipen',
    'auto-injector',
    'aspirin',
    'antihistamine',
    'dosage',
    ' mg ',
    'defibrillat',
    'aed',
    'tilt the head',
    'chin lift',
    'induce vomiting',
    'apply ice',
    'run under cold water',
  ];

  it('carries no treatment instruction while the copy is unsigned', () => {
    if (isSigned('Emergency copy')) return;

    const offenders: string[] = [];

    for (const { file, source } of sourcesUnder(
      path.join(SRC, 'features', 'emergency', 'content'),
      /\.tsx?$/,
    )) {
      // Comments are stripped first: the docblock in `guidance.ts`
      // names several of these words precisely in order to forbid them,
      // and a scan that read its own instructions as a violation would
      // be unusable.
      const prose = source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '')
        .toLowerCase();

      for (const phrase of TREATMENT_INSTRUCTION) {
        if (prose.includes(phrase)) offenders.push(`${file}: "${phrase.trim()}"`);
      }
    }

    // Failing here does not mean the guidance is wrong. It means it
    // needs item 1 of docs/SIGNOFF.md signed before a patient reads it.
    expect(offenders).toEqual([]);
  });

  /**
   * Since the W-10 owner approved translating the emergency copy
   * (2026-11-23) the words live in the catalogue, not in `content/`, so
   * the scan above reads only keys there. This is the same gate on the
   * words themselves, in BOTH languages: an Arabic treatment step is the
   * same release blocker as an English one. The Arabic list is the
   * first-aid instruction vocabulary a translator would reach for.
   */
  const TREATMENT_INSTRUCTION_AR = [
    'إنعاش',
    'ضغطات',
    'تنفس اصطناعي',
    'من الفم إلى الفم',
    'وضعية الإفاقة',
    'هايمليك',
    'ضربات على الظهر',
    'رباط ضاغط',
    'عاصبة',
    'اضغط على',
    'ارفع ال',
    'إبينفرين',
    'أدرينالين',
    'حقنة',
    'أسبرين',
    'مضاد الهيستامين',
    'جرعة',
    'ملغ',
    'مزيل الرجفان',
    'صدمة كهربائية',
    'أمل الرأس',
    'رفع الذقن',
    'تحريض القيء',
    'ثلج',
    'ماء بارد',
  ];

  it('carries no treatment instruction in the emergency catalogue keys, in either language', () => {
    if (isSigned('Emergency copy')) return;

    const offenders: string[] = [];
    const emergencyKeys = Object.keys(catalogues.en).filter((key) =>
      key.startsWith('emergency.'),
    ) as (keyof typeof catalogues.en)[];
    expect(emergencyKeys.length).toBeGreaterThan(20);

    for (const key of emergencyKeys) {
      const english = catalogues.en[key].toLowerCase();
      for (const phrase of TREATMENT_INSTRUCTION) {
        // `aed` is matched as a word: inside another word it is noise.
        const hit = phrase === 'aed' ? /\baed\b/.test(english) : english.includes(phrase);
        if (hit) offenders.push(`${key} (en): "${phrase.trim()}"`);
      }
      const arabic = catalogues.ar[key];
      for (const phrase of TREATMENT_INSTRUCTION_AR) {
        if (arabic.includes(phrase)) offenders.push(`${key} (ar): "${phrase}"`);
      }
    }

    expect(offenders).toEqual([]);
  });
});

/**
 * ── What this block asserted until 2026-09-14, and why it changed ───
 *
 * It asserted that `features/ai/` did not exist, and that no file in the
 * tree so much as named an assistant component. That was the constraint
 * `docs/SIGNOFF.md` §2 item 2 held while the artefact list was empty.
 *
 * An AI surface now exists, which is the **exact trigger §4 of that
 * document names**: "An AI surface of any kind → item 2 stops being an
 * absence and becomes an artefact list." This is that procedure, not a
 * way around it. Item 2 is **still `⛔ not signed`**, W-10 is still a
 * closed release gate, and no build ships on this register as it stands.
 *
 * What changed is which property is held. The absence that used to be
 * asserted was the absence of a *screen*; what is asserted now is the
 * absence of the thing the screen was dangerous for — generated text
 * reaching a patient, and a surface that accepts clinical input. Every
 * assertion below is narrower and harder to satisfy accidentally than
 * `existsSync(...) === false` was.
 *
 * `features/ai/ai-honesty.test.ts` holds the same line in more detail
 * and does so unconditionally, signed or not. These are the ones that
 * are specifically the signature's to hold.
 */
describe('item 2 — AI disclaimers (K-03, AD-4)', () => {
  const aiSources = () =>
    sourcesUnder(path.join(SRC, 'features', 'ai'), /\.tsx?$/).map(({ file, source }) => ({
      file,
      // Comments stripped: this directory's docblocks name the forbidden
      // shapes precisely in order to forbid them.
      source: source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''),
    }));

  it('reaches no model, by any of the names one goes by, while unsigned', () => {
    if (isSigned('AI disclaimers')) return;

    const offenders = aiSources()
      .filter(({ source }) =>
        /\bfetch\s*\(|EventSource|WebSocket|apiClient|useChat|streamCompletion|completions?\b/.test(
          source,
        ),
      )
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });

  it('stores no text that could be presented to a patient as a reply', () => {
    if (isSigned('AI disclaimers')) return;

    // A scripted answer is the shape this signature exists to prevent:
    // a machine answering a medical question with words no clinician
    // read. Test files are excluded by `sourcesUnder`, which is where
    // the one `assistant`-authored fixture legitimately lives.
    const offenders: string[] = [];
    for (const { file, source } of aiSources()) {
      for (const match of source.matchAll(/'([^'\\\n]{80,})'/g)) {
        offenders.push(`${file}: "${(match[1] ?? '').slice(0, 50)}…"`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('accepts no clinical input — the composer is not editable', () => {
    if (isSigned('AI disclaimers')) return;

    // A patient who types out their symptoms has told the app
    // something, and an app that takes that and does nothing with it
    // has lied twice. Every mount of the composer passes a state the
    // component renders read-only.
    const mounts = sourcesUnder(path.join(SRC, 'features', 'ai'), /\.tsx$/).filter(({ source }) =>
      /<AiComposer\b/.test(source),
    );

    expect(mounts.length).toBeGreaterThan(0);
    for (const { file, source } of mounts) {
      expect({ file, unavailable: /state=\{?["']?(turnState|unavailable)/.test(source) }).toEqual({
        file,
        unavailable: true,
      });
    }
  });

  it('frames every assistant screen, so none can be read without the disclaimer', () => {
    if (isSigned('AI disclaimers')) return;

    const screens = sourcesUnder(path.join(SRC, 'features', 'ai', 'screens'), /\.tsx$/);

    expect(screens.length).toBeGreaterThan(0);
    for (const { file, source } of screens) {
      expect({ file, framed: /<AiDisclaimer\s*\/>/.test(source) }).toEqual({ file, framed: true });
      expect({ file, honest: /<AiUnavailableNotice\b/.test(source) }).toEqual({
        file,
        honest: true,
      });
    }
  });

  it('keeps an AI surface out of every tree that is not features/ai', () => {
    if (isSigned('AI disclaimers')) return;

    // The original rule's real target: an assistant reachable through a
    // screen Home does not own. The entry card and the navigator are the
    // two sanctioned callers; anything else importing this directory is
    // an AI surface arriving somewhere nobody reviewed.
    const ALLOWED = [
      path.join('features', 'home', 'screens', 'HomeScreen.tsx'),
      path.join('navigation', 'AppTabs.tsx'),
    ];

    const offenders = sourcesUnder(SRC, /\.tsx?$/)
      .filter(({ file }) => !file.startsWith(path.join('features', 'ai')))
      .filter(({ file }) => !ALLOWED.includes(file))
      .filter(({ source }) => /from '@\/features\/ai/.test(source))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });
});

describe('item 3 — Results-release policy (J-06, AD-5)', () => {
  it('reads a release state rather than deriving one, while unsigned', () => {
    if (isSigned('Results-release policy')) return;

    // The dangerous shape is a screen deciding a value is safe to show:
    // `release === 'released' ? … : …` is a read and is fine;
    // `release: 'released'` written in a screen or component is the
    // client asserting a clinical decision it was not given.
    const offenders: string[] = [];

    for (const { file, source } of sourcesUnder(path.join(SRC, 'features'), /\.tsx$/)) {
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      if (/release\s*:\s*'released'/.test(code)) offenders.push(file);
    }

    expect(offenders).toEqual([]);
  });
});
