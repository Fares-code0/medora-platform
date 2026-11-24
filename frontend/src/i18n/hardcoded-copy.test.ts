import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * The hard-coded-copy ratchet (Arabic localization, foundation phase).
 *
 * Every user-facing, application-controlled string has to reach Arabic users
 * in Arabic. The catalogues and `useT` make that possible; this test makes it
 * stick. It counts, per file, the English a component still writes inline —
 * JSX text, user-facing attributes and props (`label`, `title`,
 * `aria-label`, `placeholder`, …), validation messages — and compares the
 * counts against a checked-in baseline (`hardcoded-copy.baseline.json`).
 *
 * - A file whose count **rises**, or a new file with any hit, fails: new copy
 *   goes into the catalogues, not into the component.
 * - A file whose count **falls** also fails, until the baseline is rewritten.
 *   That is the ratchet: the lower number becomes the new ceiling in the same
 *   pull request that earned it, so it can never drift back up.
 *
 * Regenerate the baseline after localizing (from `frontend/`):
 *
 * ```sh
 * UPDATE_COPY_BASELINE=1 npx vitest run src/i18n/hardcoded-copy.test.ts
 * ```
 *
 * The baseline is therefore also the inventory of what is still untranslated:
 * every entry is a file with English left in it, and the number is how much.
 *
 * Out of scope, by the owner's rules: tests, stories, the test harness, mock
 * and seed data (sample patients and clinical records are data, not chrome),
 * the theme playground (a developer tool), and the catalogues themselves.
 *
 * It is a heuristic over syntax, not a proof: a string assembled in a helper
 * and passed through three variables is invisible to it, and a technical
 * string in a `label` prop is counted. Both are fine for a ratchet — what
 * matters is that the number moves only one way.
 */

const SRC = join(process.cwd(), 'src');
const BASELINE = join(SRC, 'i18n', 'hardcoded-copy.baseline.json');

/** Same headroom as the logical-properties scan: a whole-tree walk under load. */
const WHOLE_TREE_SCAN_TIMEOUT_MS = 60_000;

/** Paths (relative to `src/`, forward slashes) that are not application copy. */
const EXCLUDED: readonly RegExp[] = [
  /\.(test|spec|stories)\.tsx?$/,
  /(^|\/)__stories__\//,
  /^test\//,
  /(^|\/)mock\//,
  /(^|\/)[\w-]*mock[\w-]*\.tsx?$/i,
  /(^|\/)seed[\w-]*\.ts$/,
  /^features\/theme-playground\//,
  /^i18n\/messages\//,
  // Seed data that lives beside the domain code it seeds.
  /^features\/shared-domain\/[\w-]+\/(store|catalogue|corpus|roster)\.ts$/,
  /^features\/doctor\/ai\/model\/store\.ts$/,
  /^features\/auth\/mock\//,
];

/** JSX attributes whose value a user reads or hears. */
const UI_ATTRIBUTES = new Set([
  'title',
  'label',
  'aria-label',
  'aria-description',
  'aria-valuetext',
  'aria-roledescription',
  'placeholder',
  'alt',
  'description',
  'helperText',
  'hint',
  'caption',
  'message',
  'subtitle',
  'heading',
  'eyebrow',
  'tooltip',
  'confirmLabel',
  'cancelLabel',
  'emptyTitle',
  'emptyDescription',
  'emptyMessage',
  'loadingLabel',
  'actionLabel',
  'ariaLabel',
  'srLabel',
  'error',
  'unit',
  'badge',
  'header',
  'body',
  'text',
  'content',
  'successMessage',
  'errorMessage',
  'emptyLabel',
  'confirmText',
  'name',
]);

/** Object-literal properties that carry the same kind of copy. */
const UI_PROPERTIES = new Set([...UI_ATTRIBUTES, 'crumb']);

/**
 * Props whose literal is copy only when it reads as prose. `name` is mostly a
 * form field's identifier (`name="email"`, `name="firstName"`) or a person —
 * neither is copy — so it counts only when the value has a space *and* a
 * capital letter: a multi-word display name such as a section or role name.
 */
const PROSE_ONLY = new Set(['name']);

/** Every key of the English catalogue, read from source (no import cycle). */
const EN_KEYS: ReadonlySet<string> = new Set(
  [...readFileSync(join(SRC, 'i18n', 'messages', 'en.ts'), 'utf8').matchAll(/^ {2}'([^']+)':/gm)].map(
    (match) => match[1] ?? '',
  ),
);

/** Calls whose string arguments are shown to a user. */
const UI_CALLS = new Set([
  // zod: `.min(1, 'Required')`, `.email('Enter a valid email')`
  'min',
  'max',
  'length',
  'email',
  'url',
  'regex',
  'refine',
  'nonempty',
  // feedback
  'toast',
  'success',
  'warning',
  'info',
  'announce',
  'setError',
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(tsx|ts)$/.test(entry) && !entry.endsWith('.d.ts') ? [full] : [];
  });
}

function relativePath(file: string): string {
  return relative(SRC, file).replace(/\\/g, '/');
}

/** Does this literal text read as English copy rather than a token or key? */
function isCopy(text: string): boolean {
  const value = text.trim();
  if (!/[A-Za-z]{2,}/.test(value)) return false;
  // A catalogue key (`ui.pageOf`), an i18n-style id, a CSS/URL/path token.
  if (/^[a-z][\w-]*(\.[\w#-]+)+$/.test(value)) return false;
  if (/^(https?:|mailto:|\/|#|\.\/|@\/)/.test(value)) return false;
  // A single identifier-ish token with no space and no capital letter
  // (`primary`, `aria-hidden`, `snake_case`) is a value, not prose.
  if (!/\s/.test(value) && !/[A-Z]/.test(value)) return false;
  // SCREAMING_CASE codes and dotted/colon tokens.
  if (/^[A-Z0-9_:-]+$/.test(value) && value.includes('_')) return false;
  // A Tailwind class list (`bg-error-subtle text-error`): lower-case tokens,
  // every one of them hyphenated or variant-prefixed.
  if (!/[A-Z]/.test(value) && value.split(/\s+/).every((token) => /[-:[]/.test(token))) {
    return false;
  }
  return true;
}

function templateHasCopy(node: ts.TemplateExpression | ts.NoSubstitutionTemplateLiteral): boolean {
  if (ts.isNoSubstitutionTemplateLiteral(node)) return isCopy(node.text);
  const parts = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)];
  return isCopy(parts.join(' '));
}

/** Count the copy-bearing string expressions inside an attribute/prop value. */
function countInValue(node: ts.Node): number {
  if (ts.isStringLiteral(node)) return isCopy(node.text) ? 1 : 0;
  if (ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
    return templateHasCopy(node) ? 1 : 0;
  }
  if (ts.isJsxExpression(node)) return node.expression ? countInValue(node.expression) : 0;
  if (ts.isParenthesizedExpression(node)) return countInValue(node.expression);
  if (ts.isConditionalExpression(node)) {
    return countInValue(node.whenTrue) + countInValue(node.whenFalse);
  }
  if (ts.isBinaryExpression(node)) {
    const op = node.operatorToken.kind;
    if (
      op === ts.SyntaxKind.BarBarToken ||
      op === ts.SyntaxKind.QuestionQuestionToken ||
      op === ts.SyntaxKind.AmpersandAmpersandToken ||
      op === ts.SyntaxKind.PlusToken
    ) {
      return countInValue(node.left) + countInValue(node.right);
    }
  }
  return 0;
}

/** `countInValue`, but for a `PROSE_ONLY` prop only a multi-word, capitalised literal counts. */
function countFor(name: string, node: ts.Node): number {
  if (!PROSE_ONLY.has(name)) return countInValue(node);
  const literal = ts.isJsxExpression(node) ? node.expression : node;
  if (literal === undefined || !ts.isStringLiteralLike(literal)) return 0;
  return /\s/.test(literal.text.trim()) && /[A-Z]/.test(literal.text) && isCopy(literal.text) ? 1 : 0;
}

function propertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  return undefined;
}

function calleeName(call: ts.CallExpression): string | undefined {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return undefined;
}

interface Hit {
  readonly line: number;
  readonly text: string;
}

/** Every hard-coded copy site in one file. */
function findHardcodedCopy(fileName: string, source: string): Hit[] {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const hits: Hit[] = [];
  const record = (node: ts.Node, found: number): void => {
    if (found === 0) return;
    const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
    const text = node.getText(file).replace(/\s+/g, ' ').slice(0, 100);
    for (let index = 0; index < found; index += 1) hits.push({ line, text });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) {
      record(node, isCopy(node.text) ? 1 : 0);
    } else if (
      ts.isJsxExpression(node) &&
      node.expression &&
      (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))
    ) {
      // `{busy ? 'Saving…' : 'Save'}` as a child.
      record(node, countInValue(node.expression));
    } else if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(file);
      if (UI_ATTRIBUTES.has(name) && node.initializer) record(node, countFor(name, node.initializer));
      return; // nested JSX inside an attribute is rare; do not double count
    } else if (ts.isPropertyAssignment(node)) {
      const name = propertyName(node.name);
      // `{ label: 'Active', labelKey: 'rx.status.active' }` is a migration
      // pair: the key is what components render, and the English beside it is
      // kept, under test, for model code that has no translator yet. The pair
      // only counts as one if the key is a real catalogue key — an invented
      // `labelKey` must not hide the English beside it.
      const paired =
        name !== undefined &&
        ts.isObjectLiteralExpression(node.parent) &&
        node.parent.properties.some(
          (sibling) =>
            ts.isPropertyAssignment(sibling) &&
            propertyName(sibling.name) === `${name}Key` &&
            ts.isStringLiteralLike(sibling.initializer) &&
            EN_KEYS.has(sibling.initializer.text),
        );
      if (name !== undefined && UI_PROPERTIES.has(name) && !paired) {
        record(node, countFor(name, node.initializer));
      }
    } else if (ts.isBindingElement(node) && node.initializer) {
      // A prop's English default: `({ cancelLabel = 'Go back' })`.
      const bound = node.propertyName ?? node.name;
      const name = ts.isIdentifier(bound) || ts.isStringLiteral(bound) ? bound.text : undefined;
      if (name !== undefined && UI_PROPERTIES.has(name)) record(node, countFor(name, node.initializer));
    } else if (ts.isCallExpression(node)) {
      const name = calleeName(node);
      if (name !== undefined && UI_CALLS.has(name)) {
        for (const argument of node.arguments) record(argument, countInValue(argument));
      }
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(file, visit);
  return hits;
}

function countHardcodedCopy(fileName: string, source: string): number {
  return findHardcodedCopy(fileName, source).length;
}

function scanTree(): Record<string, number> {
  const counts: Record<string, number> = {};
  /*
   * `COPY_REPORT=components/ui` prints every remaining site under that path
   * prefix: the worklist for a localization pass. Off by default.
   */
  const report = process.env.COPY_REPORT;
  const lines: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const path = relativePath(file);
    if (EXCLUDED.some((pattern) => pattern.test(path))) continue;
    const hits = findHardcodedCopy(path, readFileSync(file, 'utf8'));
    if (hits.length > 0) counts[path] = hits.length;
    if (report !== undefined && report !== '' && path.startsWith(report)) {
      for (const hit of hits) lines.push(`${path}:${String(hit.line)}  ${hit.text}`);
    }
  }
  if (lines.length > 0) console.log(lines.join('\n'));
  return counts;
}

function readBaseline(path: string = BASELINE): Record<string, number> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, number>;
}

function writeBaseline(counts: Record<string, number>, path: string = BASELINE): void {
  const sorted = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(path, `${JSON.stringify(sorted, null, 2)}\n`.replace(/\n/g, '\r\n'));
}

/** Compare counts with a baseline: rises/new files and falls/removed files. */
function compareWithBaseline(
  current: Record<string, number>,
  baseline: Record<string, number>,
): { grew: string[]; shrank: string[] } {
  const grew: string[] = [];
  const shrank: string[] = [];
  for (const [path, count] of Object.entries(current)) {
    const allowed = baseline[path] ?? 0;
    if (count > allowed) grew.push(`${path}: ${String(allowed)} → ${String(count)}`);
    else if (count < allowed) shrank.push(`${path}: ${String(allowed)} → ${String(count)}`);
  }
  for (const [path, allowed] of Object.entries(baseline)) {
    if (!(path in current)) shrank.push(`${path}: ${String(allowed)} → 0`);
  }
  return { grew, shrank };
}

/*
 * The second ratchet: components that still render a paired label map's
 * English `label` instead of `t(meta.labelKey)`. A `.label` read is not a
 * literal, so the copy scan above cannot see it; this counts the direct reads
 * (`PATIENT_STATUS_META[status].label`) in `.tsx` files. Model code (`.ts`:
 * filter-chip builders, exports) is out of its reach on purpose — those
 * callers have no translator yet and are inventoried by the README.
 */
const PAIRED_LABEL_BASELINE = join(SRC, 'i18n', 'paired-label-reads.baseline.json');

const PAIRED_LABEL_MAPS = [
  'LAB_STATUS_META',
  'LAB_PRIORITY_META',
  'LAB_RESULT_FLAG_META',
  'LAB_ATTACHMENT_KIND_META',
  'PATIENT_STATUS_META',
  'RISK_LEVEL_META',
  'PRESCRIPTION_STATUS_META',
  'REFILL_STATUS_META',
  'SAFETY_WARNING_KIND_META',
  'SAFETY_WARNING_SEVERITY_META',
  'PRESCRIPTION_TIMELINE_META',
  'SAFETY_EVIDENCE_META',
];

const PAIRED_LABEL_READ = new RegExp(
  String.raw`\b(?:${PAIRED_LABEL_MAPS.join('|')})\[[^\]]+\]\.label\b`,
  'g',
);

function scanPairedLabelReads(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const file of sourceFiles(SRC)) {
    const path = relativePath(file);
    if (!path.endsWith('.tsx') || EXCLUDED.some((pattern) => pattern.test(path))) continue;
    const count = (readFileSync(file, 'utf8').match(PAIRED_LABEL_READ) ?? []).length;
    if (count > 0) counts[path] = count;
  }
  return counts;
}

describe('hard-coded English copy', () => {
  it(
    'never grows, and the baseline follows every reduction',
    () => {
      const current = scanTree();

      if (process.env.UPDATE_COPY_BASELINE === '1') {
        writeBaseline(current);
        return;
      }

      const { grew, shrank } = compareWithBaseline(current, readBaseline());
      expect(
        grew,
        'New hard-coded English. Put the copy in src/i18n/messages/en.ts (and ar.ts) and render it with t().',
      ).toEqual([]);
      expect(
        shrank,
        'Less hard-coded English than the baseline records — good. Lock it in: UPDATE_COPY_BASELINE=1 npx vitest run src/i18n/hardcoded-copy.test.ts',
      ).toEqual([]);
    },
    WHOLE_TREE_SCAN_TIMEOUT_MS,
  );

  it(
    'renders paired label maps through labelKey, and never adds an English .label read',
    () => {
      const current = scanPairedLabelReads();

      if (process.env.UPDATE_COPY_BASELINE === '1') {
        writeBaseline(current, PAIRED_LABEL_BASELINE);
        return;
      }

      const { grew, shrank } = compareWithBaseline(current, readBaseline(PAIRED_LABEL_BASELINE));
      expect(
        grew,
        'A component renders a paired label map’s English `.label`. Render t(meta.labelKey) instead.',
      ).toEqual([]);
      expect(
        shrank,
        'Fewer English .label reads than the baseline records — lock it in: UPDATE_COPY_BASELINE=1 npx vitest run src/i18n/hardcoded-copy.test.ts',
      ).toEqual([]);
    },
    WHOLE_TREE_SCAN_TIMEOUT_MS,
  );

  it('finds copy in a known shape, so a broken scanner cannot pass silently', () => {
    const sample = `
      export function Sample({ busy }: { busy: boolean }) {
        return (
          <section aria-label="Patient list">
            <h2>Upcoming visits</h2>
            <input placeholder={busy ? 'Saving…' : 'Search patients'} />
            <Button label={t('ui.save')} variant="primary" />
            {busy && 'Loading more'}
            <Tooltip content="Copy code" />
            <Banner text="All caught up" />
            <Field name="firstName" />
            <Section name="Clinic Policies" />
          </section>
        );
      }
      const schema = z.string().min(1, 'Name is required');
      const route = { title: 'Patients', path: '/patients' };
      function Field({ cancelLabel = 'Go back' }) { return null; }
      const status = { label: 'Active', labelKey: 'rx.status.active' };
      const invented = { label: 'Anything', labelKey: 'no.such.key' };
      const classes = { error: 'bg-error-subtle text-error' };
      const notice = { successMessage: 'Saved the policy', emptyLabel: 'No rooms yet' };
    `;
    // Counted: aria-label, JSX text, two placeholder branches, a JSX-child
    // literal, the tooltip content, the banner text, the multi-word section
    // name, the zod message, the route title, the prop default, the label
    // whose "key" is not in the catalogue, successMessage and emptyLabel.
    // Not counted: the t() key, the variant, the form field's name, the label
    // paired with a real key, and the class list.
    expect(countHardcodedCopy('sample.tsx', sample)).toBe(14);
  });

  it('counts direct English .label reads of a paired map', () => {
    const sample =
      'label={PATIENT_STATUS_META[p.status].label} other={t(RISK_LEVEL_META[r].labelKey)} ' +
      'x={OTHER_META[a].label}';
    expect(sample.match(PAIRED_LABEL_READ) ?? []).toHaveLength(1);
  });

  it('scans the tree at all', () => {
    expect(sourceFiles(SRC).length).toBeGreaterThan(300);
    expect(EN_KEYS.size).toBeGreaterThan(400);
  });
});
