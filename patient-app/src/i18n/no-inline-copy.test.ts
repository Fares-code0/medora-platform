import fs from 'node:fs';
import path from 'node:path';

/**
 * No screen holds its own English — checklist C-09.
 *
 * ── Why a source scan and not more render tests ─────────────────────
 *
 * `auth-i18n.test.tsx` and `shell-i18n.test.tsx` render screens in Arabic
 * and assert the English is gone. That catches what they render, which is
 * the reachable half of a screen: an error branch, a rarely-taken empty
 * state or a confirmation sheet can hold a hardcoded sentence for months
 * and no render test will see it.
 *
 * This scan sees all of it, cheaply, and it is the test that keeps C-09
 * closed. It reads every source file under `src/` and fails on a
 * user-facing prop whose value is a bare string literal starting with a
 * capital letter — `label="Save changes"`, `title="Allergies"` — which is
 * what an unmigrated line looks like.
 *
 * ── What it deliberately allows ─────────────────────────────────────
 *
 * `EXPECTED` is not a list of things to get round to. Every entry is a
 * decision recorded elsewhere, and adding one has to be as deliberate as
 * the decision was:
 *
 * - **The product name.** "Medora" is a name; a name is not translated.
 * - **Development-only controls.** `__DEV__`-gated, absent from a release
 *   build, and read by developers.
 *
 * Until 2026-11-23 the list also exempted the whole emergency feature,
 * the affordances leading to it and the crash screen. The W-10 owner
 * approved translating all application-controlled copy that day, so
 * those exemptions are gone and the emergency directory is scanned like
 * every other (`EXEMPT_DIRECTORIES` no longer exists). The clinical
 * sign-off on the Arabic is still not given — that is a review, not an
 * exemption, and `docs/SIGNOFF.md` holds it.
 *
 * A file that is not a screen or a component — a service, a schema, a
 * fixture — is out of scope: this asks about rendered copy. A fixture's
 * "Hypertension" is data standing in for the server's, and a Zod
 * message is the separate C-09 problem the row names (a module-level
 * schema cannot read a hook). `SCANNED` is the list of directories that
 * render.
 *
 * Comments are stripped before matching, so a docblock showing
 * `title="No appointments"` as an example is not a finding — teaching
 * the pattern is what those examples are for.
 *
 * ── What it missed, and now does not ────────────────────────────────
 *
 * Two gaps, both found on 2026-09-12 by reading the screens rather than
 * by running this.
 *
 * **A prop whose value does not start with a capital.**
 * `label="6-digit code"` on the two-factor form sat through every run,
 * because the pattern above asked for `[A-Z]`. A digit is now a first
 * character too.
 *
 * **Copy that is not a prop at all.** `<Text>Security</Text>` is a
 * sentence on a screen and matches nothing above. `SecurityScreen`,
 * `ChangePasswordForm`, `TwoFactorSetup` and `LabResultsScreen` were
 * carrying **thirteen** English sentences between them — and the
 * catalogue already held every one of the keys, written by C-09 and
 * never wired up. A patient reading the app in Arabic got an English
 * security screen, and the translation that existed for it was dead
 * code. The second test below reads JSX text nodes for exactly that.
 */

const SRC = path.resolve(__dirname, '..');

/** The `<file>` half of an exemption key: `/`-separated, whatever the OS hands back. */
function keyPath(file: string): string {
  return path.relative(SRC, file).split(path.sep).join('/');
}

/** The directories whose files put words on a screen. */
const SCANNED = [
  'components',
  'navigation',
  'bootstrap',
  'features',
  // Rendering files outside the four above. `privacy/PhiPrivacyShield.tsx`
  // put an English app-switcher cover on an Arabic phone until 2026-11-23
  // because this list did not include it.
  'privacy',
  'network',
  'theme',
  'accessibility',
];

/**
 * Only `.tsx`, which is the whole of the old `features/` narrowing.
 *
 * The narrowing kept `features/<x>/screens/` and `features/<x>/components/`
 * and nothing else, so a renderer anywhere else in a feature was skipped
 * whole: `features/app-version/UpgradeGate.tsx` — the forced-upgrade wall,
 * the one screen a patient cannot navigate away from — and
 * `features/appointments/booking/BookingFlow.tsx`, a five-step flow, were
 * never read at all. That is why `label="Update Medora"`, a shape the prop
 * scan was already built to catch, went unreported for as long as it
 * existed.
 *
 * What the narrowing was actually for is keeping services, fixtures and
 * schemas out — a fixture's "Hypertension" is data standing in for the
 * server's, and a module-level Zod message is the separate problem C-09
 * names. Every one of those is a `.ts` file and copy reaches a patient
 * through JSX, so the extension is the honest filter and it does not skip
 * a renderer for living in the wrong folder.
 */
function rendersCopy(file: string): boolean {
  return file.endsWith('.tsx');
}

/** Props whose value a patient reads. */
const COPY_PROPS = [
  'label',
  'title',
  'subtitle',
  'body',
  'detail',
  'hint',
  'placeholder',
  'message',
  'confirmLabel',
  'cancelLabel',
  'accessibilityLabel',
  'accessibilityHint',
];

/**
 * Three shapes, because copy reaches a patient through all of them: a
 * JSX attribute (`label="Save"`), an object property (`{ label: 'Save' }`,
 * which is how `pressableA11y` and every `empty={{ … }}` take theirs),
 * and a **default parameter** (`cancelLabel = 'Cancel'`).
 *
 * A scan that saw only the first would miss the header's Emergency
 * button entirely. A scan that saw only the first two missed
 * `ConfirmSheet`, which is worse: a default is copy that appears
 * wherever the prop is *not* passed, so the same English reaches every
 * caller that did the ordinary thing, on a surface nothing renders
 * until a patient opens it. Two sheets had it — closing an account and
 * signing out — and read Arabic above an English Cancel for as long as
 * the component has existed.
 */
const COPY_PATTERNS = [
  new RegExp(`\\b(${COPY_PROPS.join('|')})="([A-Z0-9][^"]{2,})"`, 'g'),
  new RegExp(`\\b(${COPY_PROPS.join('|')}):\\s*'([A-Z0-9][^']{2,})'`, 'g'),
  new RegExp(`\\b(${COPY_PROPS.join('|')})\\s*=\\s*'([A-Z0-9][^']{2,})'`, 'g'),
  // A template literal as a prop: `label={\`Call \${label}\`}`. The emergency
  // call button carried five of these, and none of the shapes above can
  // see one. A template that STARTS with an interpolation (`\${a}. \${b}`)
  // is punctuation around translated values and is not matched.
  new RegExp(`\\b(${COPY_PROPS.join('|')})=\\{\`([A-Z0-9][^\`]{2,})\`\\}`, 'g'),
  // A heading's accessible name: `headingA11y('Emergency help')`.
  /\b(headingA11y)\(\s*'([A-Z0-9][^']{2,})'/g,
];

function copyLiterals(source: string): { prop: string; text: string }[] {
  return COPY_PATTERNS.flatMap((pattern) =>
    [...source.matchAll(pattern)].map((match) => ({
      prop: match[1] ?? '',
      text: match[2] ?? '',
    })),
  );
}

/**
 * Every allowed inline string, with the decision that allows it.
 *
 * Keyed by `<file> → <exact text>`, so an exemption covers one sentence
 * in one place. "Try again" is allowed on the crash screen and nowhere
 * else, which is what an exemption should mean.
 */
const EXPECTED: Readonly<Record<string, string>> = {
  // A name is not translated.
  'navigation/AppTabs.tsx → Medora': 'the product name',
  'features/auth/screens/WelcomeScreen.tsx → Medora': 'the product name',
  // Development-only, `__DEV__`-gated, never in a release build.
  'features/auth/screens/LoginScreen.tsx → Continue as Demo Patient': 'development build only',
};

/**
 * Text a patient reads that is not a prop: `<Text>Security</Text>`.
 *
 * The scan collapses JSX expressions to nothing, then looks at what sits
 * between a `>` and the next `<`. It ignores anything with punctuation
 * that belongs to code rather than to prose, and anything carrying a
 * TypeScript keyword — `interface Props<T> {` produces a `>`…`<` pair
 * too, and a generic is not a sentence.
 */
const TYPESCRIPT =
  /\b(export|interface|function|extends|const|type|readonly|return|import|typeof|implements)\b/;
const CODE_PUNCTUATION = /[=:;(){}|[\]]/;

/**
 * The three entities JSX prose uses, decoded before the punctuation test.
 * `&apos;` ends in a semicolon, so a sentence with an apostrophe in it —
 * "your phone&apos;s dialler" — used to read as code and was skipped:
 * that is how the urgent-help lines on the Support and Upgrade screens
 * stayed English without ever being reported.
 */
function decodeEntities(text: string): string {
  return text
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}
const TWO_WORDS = /^[A-Za-z][A-Za-z\u2019'-]*(\s+[A-Za-z\u2019'-]+)+/;

function textNodes(source: string): string[] {
  const collapsed = source.replace(/\{[^{}]*\}/g, '{}');
  const found: string[] = [];
  for (const match of collapsed.matchAll(/>([^<>]+)</g)) {
    const text = decodeEntities((match[1] ?? '').replace(/\{\}/g, ''))
      .split(/\s+/)
      .join(' ')
      .trim();
    if (text.length < 6) continue;
    if (CODE_PUNCTUATION.test(text) || TYPESCRIPT.test(text)) continue;
    if (!TWO_WORDS.test(text)) continue;
    found.push(text);
  }
  return found;
}

/**
 * Every allowed sentence on a screen, with the decision that allows it.
 * The same three decisions as `EXPECTED` above, in the same shape.
 */
const EXPECTED_TEXT: Readonly<Record<string, string>> = {
  'features/auth/screens/LoginScreen.tsx → Local development session for . Not available in a release build.':
    'development build only',
  'features/auth/screens/LoginScreen.tsx → Development build — fixture data':
    'development build only',
};

function allFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return allFiles(full);
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
    return [full];
  });
}

function sourceFiles(): string[] {
  return SCANNED.flatMap((top) => allFiles(path.join(SRC, top))).filter((file) =>
    rendersCopy(path.relative(SRC, file)),
  );
}

/**
 * The functions whose argument becomes visible copy.
 *
 * Copy reaches a patient by a third route that is neither a prop nor a
 * text node: a string handed to something that puts it on screen later.
 * `TwoFactorSetup` announced both halves of two-factor enrolment that
 * way, in English, with `security.twoFactor.enabled` and `.disabled`
 * sitting unused in both catalogues.
 *
 * A general "English literal as a call argument" scan is not the answer —
 * it reports every `logger.warn`, every route name and every
 * `EndpointNotImplementedError` dependency string, and the signal drowns
 * (110 hits, two of them real). So this is an explicit list of the
 * functions that render what they are given. Adding one to the codebase
 * means adding it here; the list is short because the ways to get text on
 * screen are few.
 */
const TEXT_SETTERS = [
  // Screen-reader announcements are copy a patient hears. The emergency
  // call button announced its dialler failure in English this way.
  'announce',
  'toast.show',
  'show',
  'setNotice',
  'setBanner',
  'setFailure',
  'setError',
  'setMessage',
];

const SETTER_PATTERN = new RegExp(
  String.raw`\b(${TEXT_SETTERS.map((name) => name.replace('.', String.raw`\.`)).join('|')})\(\s*` +
    String.raw`(?:'([A-Z][^'\\]{3,})'|"([A-Z][^"\\]{3,})"|` +
    '`([A-Z][^`$]{3,})`)',
  'g',
);

function setterLiterals(source: string): { setter: string; text: string }[] {
  return [...source.matchAll(SETTER_PATTERN)].map((match) => ({
    setter: match[1] ?? '',
    text: match[2] ?? match[3] ?? match[4] ?? '',
  }));
}

/** Block and line comments, so a worked example is not a finding. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('screens read the catalogue (C-09)', () => {
  it('renders no user-facing prop from a bare English literal', () => {
    const found: string[] = [];

    for (const file of sourceFiles()) {
      const relative = keyPath(file);
      for (const { prop, text } of copyLiterals(withoutComments(fs.readFileSync(file, 'utf8')))) {
        if (`${relative} → ${text}` in EXPECTED) continue;
        found.push(`${relative} → ${prop}="${text}"`);
      }
    }

    expect(found).toEqual([]);
  });

  it('renders no sentence of its own, outside the decisions that allow it', () => {
    const found: string[] = [];

    for (const file of sourceFiles()) {
      if (!file.endsWith('.tsx')) continue;
      const relative = keyPath(file);
      for (const text of textNodes(withoutComments(fs.readFileSync(file, 'utf8')))) {
        if (`${relative} → ${text}` in EXPECTED_TEXT) continue;
        found.push(`${relative} → ${text}`);
      }
    }

    expect(found).toEqual([]);
  });

  it('hands no English literal to a setter that renders it', () => {
    // The third route copy takes to a screen, and the one a reader is
    // least likely to look for: the string is not next to the component
    // that shows it.
    const found: string[] = [];

    for (const file of sourceFiles()) {
      const relative = keyPath(file);
      for (const { setter, text } of setterLiterals(
        withoutComments(fs.readFileSync(file, 'utf8')),
      )) {
        if (`${relative} → ${text}` in EXPECTED || `${relative} → ${text}` in EXPECTED_TEXT) {
          continue;
        }
        found.push(`${relative} → ${setter}("${text}")`);
      }
    }

    expect(found).toEqual([]);
  });

  it('ignores the calls that are not copy', () => {
    // The scan's own regression test. A general argument scan drowns in
    // these three, which is why `TEXT_SETTERS` is a closed list.
    expect(setterLiterals("setNotice('Two-factor authentication is on.')")).toEqual([
      { setter: 'setNotice', text: 'Two-factor authentication is on.' },
    ]);
    expect(setterLiterals("setNotice(t('security.twoFactor.enabled'))")).toEqual([]);
    expect(setterLiterals("logger.warn('No dialler is available on this device')")).toEqual([]);
    expect(setterLiterals("navigation.navigate('DoctorProfile', { id })")).toEqual([]);
    expect(
      setterLiterals("new EndpointNotImplementedError('BE-10 / M8', 'Your sessions')"),
    ).toEqual([]);
  });

  it('sees the shapes it was blind to before the emergency copy moved', () => {
    // The scan's regression test for the three shapes added with the
    // W-10 translation approval (2026-11-23).
    expect(copyLiterals('label={`Call ${label}`}')).toEqual([
      { prop: 'label', text: 'Call ${label}' },
    ]);
    expect(copyLiterals('accessibilityLabel={`${a}. ${b}`}')).toEqual([]);
    expect(copyLiterals("headingA11y('Emergency help')")).toEqual([
      { prop: 'headingA11y', text: 'Emergency help' },
    ]);
    expect(setterLiterals("announce('Could not open the dialler.')")).toEqual([
      { setter: 'announce', text: 'Could not open the dialler.' },
    ]);
    expect(textNodes('<Text>Call your phone&apos;s dialler now</Text>')).toEqual([
      "Call your phone's dialler now",
    ]);
  });

  it('keeps the bundled emergency content as keys, not prose', () => {
    // `content/guidance.ts` is a `.ts` module, so the render scans above
    // never read it. It holds the red flags and the call-or-book guidance
    // by KEY since the W-10 translation approval; a sentence written back
    // into it would reach the screen in English in every language.
    const source = withoutComments(
      fs.readFileSync(path.join(SRC, 'features', 'emergency', 'content', 'guidance.ts'), 'utf8'),
    );
    const literals = [...source.matchAll(/'([^'\n]*)'/g)].map((match) => match[1] ?? '');
    const prose = literals.filter(
      (literal) => !/^emergency\.[a-zA-Z.]+$/.test(literal) && !/^[a-z]+$/.test(literal),
    );
    // `@/i18n` is the one import; ids are single lower-case words.
    expect(prose).toEqual(['@/i18n']);
  });

  /**
   * The inverse question, and the one that found most of the rest.
   *
   * A key nobody reads is almost never dead weight — it is a screen that
   * was supposed to read it and did not. The sweep this came from found
   * thirteen behind `SecurityScreen`, `TwoFactorSetup`,
   * `ChangePasswordForm`, `UpgradeGate` and `LabResultsScreen`: the
   * entries were written, shipped in both languages, and the screens
   * rendered English beside them.
   *
   * The scans above cannot see that. They find English where a key should
   * be; this finds a key where English is, by reading one file and
   * grepping. A genuinely unwanted key is deleted, not exempted.
   */
  it('has no catalogue key that nothing reads', () => {
    const catalogue = fs.readFileSync(path.join(SRC, 'i18n', 'messages', 'en.ts'), 'utf8');
    const keys = [...catalogue.matchAll(/^ {2}'([A-Za-z0-9_.-]+)':/gm)].map((match) => match[1]);
    expect(keys.length).toBeGreaterThan(100);

    // Every source file, not just the ones that render: a key can
    // legitimately be referenced from a map in a hook or a model.
    const sources = allFiles(SRC)
      .filter((file) => !file.includes(path.join('i18n', 'messages')))
      .map((file) => fs.readFileSync(file, 'utf8'))
      .join('\n');

    // Both quote styles: `t('x.y')` and `emptyTitleKey="x.y"` are both real
    // call sites, and accepting only one reports the other as unused.
    const unread = keys.filter(
      (key) => !sources.includes(`'${String(key)}'`) && !sources.includes(`"${String(key)}"`),
    );

    expect(unread).toEqual([]);
  });

  it('carries no exemption for a string that is no longer there', () => {
    // An allow-list nobody prunes stops describing the tree and starts
    // hiding it: the next inline string that happens to match a stale
    // entry passes silently. So every entry has to still be real.
    const present = new Set<string>();
    for (const file of allFiles(SRC)) {
      const relative = keyPath(file);
      for (const { text } of copyLiterals(withoutComments(fs.readFileSync(file, 'utf8')))) {
        present.add(`${relative} → ${text}`);
      }
    }

    expect(present.size).toBeGreaterThan(0);
    for (const allowed of Object.keys(EXPECTED)) {
      expect({ allowed, stillThere: present.has(allowed) }).toEqual({ allowed, stillThere: true });
    }

    const sentences = new Set<string>();
    for (const file of allFiles(SRC)) {
      if (!file.endsWith('.tsx')) continue;
      const relative = keyPath(file);
      for (const text of textNodes(withoutComments(fs.readFileSync(file, 'utf8')))) {
        sentences.add(`${relative} → ${text}`);
      }
    }
    for (const allowed of Object.keys(EXPECTED_TEXT)) {
      expect({ allowed, stillThere: sentences.has(allowed) }).toEqual({
        allowed,
        stillThere: true,
      });
    }
  });
});
