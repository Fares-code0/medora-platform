import fs from 'node:fs';
import path from 'node:path';

/**
 * The accessibility audit stays true — checklist S-09.
 *
 * `docs/A11Y_AUDIT.md` records findings and verdicts. A document does not
 * defend itself: the way an audit becomes wrong is never that someone
 * edits it, it is that someone adds a screen without a heading or a
 * pressable without a label and does not think about a markdown file in
 * another directory.
 *
 * So these tests do not check the prose. They check the **facts the audit
 * asserts**, in the idiom `store-privacy.test.ts` established, and each
 * failure names the finding it re-opens.
 */

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src');

function sourcesUnder(dir: string, match: RegExp): { file: string; source: string }[] {
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

describe('§3 S-02 — every screen is navigable by a screen reader', () => {
  it('gives every screen a heading for the rotor to land on', () => {
    // Finding F-3: `ThreadScreen` was the one screen of 27 without one,
    // so the only thing naming it was the navigator's generic
    // "Conversation". If this fails, a screen was added without a
    // heading and A11Y_AUDIT.md §2 has a fifth finding.
    const offenders = sourcesUnder(path.join(SRC, 'features'), /screens[/\\].*\.tsx$/)
      .filter(({ source }) => !source.includes('headingA11y'))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });

  it('labels every pressable, or hides it deliberately', () => {
    // `pressableA11y` REQUIRES a label in its signature, which is the
    // control that matters — this catches the case that bypasses it.
    // The one legitimate exception is a scrim: a full-screen dismiss
    // target behind a sheet, which must not be an announced control.
    const offenders: string[] = [];

    for (const { file, source } of sourcesUnder(SRC, /\.tsx$/)) {
      // The `(?<!=)` matters: without it the match ends at the `>` of an
      // arrow function in `onPress={() => …}`, which truncates the props
      // and reports every labelled pressable as unlabelled.
      const opening = /<(?:Pressable|TouchableOpacity|TouchableHighlight)\b((?:[^>]|=>)*?)(?<!=)>/g;
      let match: RegExpExecArray | null;
      while ((match = opening.exec(source)) !== null) {
        const attributes = match[1] ?? '';
        const labelled = /pressableA11y|accessibilityLabel/.test(attributes);
        const hidden = /accessibilityElementsHidden|importantForAccessibility="no"/.test(
          attributes,
        );
        if (!labelled && !hidden) offenders.push(`${file}: ${attributes.slice(0, 60).trim()}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe('§5 — colour is never the only carrier', () => {
  it('gives every Badge a text label', () => {
    // WCAG 1.4.1. `Badge`'s signature makes `label` required; this
    // catches a `Badge` rendered with an empty one.
    const offenders = sourcesUnder(SRC, /\.tsx$/)
      .filter(({ source }) => /<Badge\s+label=""/.test(source))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });
});

describe('the document itself', () => {
  const doc = fs.readFileSync(path.join(ROOT, 'docs', 'A11Y_AUDIT.md'), 'utf8');

  it('is the S-09 deliverable and walks every row of Phase S', () => {
    expect(doc).toContain('S-09');
    for (const row of ['S-01', 'S-02', 'S-03', 'S-04', 'S-05', 'S-06', 'S-07', 'S-08']) {
      expect(doc).toContain(row);
    }
  });

  it('records its findings rather than reporting a clean sweep', () => {
    // A clean audit with no findings usually means the audit was not
    // run. Four came out of the sweep itself, and two out of later work
    // that walked past them.
    for (const finding of ['F-1', 'F-2', 'F-3', 'F-4', 'F-5', 'F-6']) {
      expect(doc).toContain(finding);
    }
  });

  it('names what still needs a device instead of counting it as passed', () => {
    expect(doc).toContain('VoiceOver');
    expect(doc).toContain('TalkBack');
    expect(doc).toContain('B-07');
  });

  it('does not claim an owner has signed it off', () => {
    // W-10 carries the sign-off, and it is ⬜. If someone answers it,
    // this assertion is the prompt to change the line deliberately
    // rather than let an unsigned audit be read as a signed one.
    expect(doc).toContain('not given');
    expect(doc).toContain('W-10');
  });
});
