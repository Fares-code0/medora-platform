#!/usr/bin/env node
/**
 * Retired-token guard — ADR-0001 §11.
 *
 * Wave 1a revalued a set of tokens into aliases of their successors so that
 * Wave 1b could delete them with zero visual diff. They are now gone. This
 * fails the build if any come back, because the failure mode is silent: a
 * `var(--radius-lg)` that no longer resolves does not error, it just renders
 * with no radius, and `rounded-lg` outside our theme quietly falls back to
 * Tailwind's own scale — the wrong value, with no warning.
 *
 * Run: node scripts/check-retired-tokens.mjs   (wired into `npm run lint`)
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

/** pattern → what to use instead */
const RETIRED = [
  [/--(?:radius|shadow)-(?:xs|sm|md|lg|xl|2xl|full)\b/g, 'radius: control|surface|pill · shadow: card|popover|modal|focus'],
  [/\brounded(?:-(?:t|b|l|r|tl|tr|bl|br|ss|se|es|ee|s|e))?-(?:xs|sm|md|lg|xl|2xl|full)\b/g, 'rounded-control | rounded-surface | rounded-pill'],
  [/\bshadow-(?:xs|sm|md|lg|xl)\b/g, 'shadow-card | shadow-popover | shadow-modal | shadow-focus'],
  [/--color-(?:success-text|warning-text|text-link)\b/g, '--color-success | --color-warning | --color-primary'],
  [/\btext-(?:success-text|warning-text|text-link)\b/g, 'text-success | text-warning | text-primary'],
  [/--(?:text|leading)-body-lg\b|\btext-body-lg\b/g, 'text-h4'],
  // Wave 2a — removed primitives. Re-importing one should fail the build, not
  // review: `Surface` was exported with zero call sites for long enough that
  // nobody noticed it had drifted out of the elevation model.
  [/\bfrom\s+['"][^'"]*\/Surface['"]/g, 'Card, or a plain bordered div'],
  [/\bSurfaceProps\b/g, 'Card / CardProps'],
  /*
   * Wave 2c-b — the Administration Center's second table engine. `DataTable`
   * now carries everything `DataGrid` could do (`hideBelowMd`, the bare
   * container, flat rows, the taller admin row) plus sorting, selection,
   * loading and error states it never had. A second engine coming back would
   * re-split the two areas by stealth, which is how the first one arrived.
   *
   * The admin configuration is: bare · zebra={false} · density="admin" ·
   * stickyHeader={false} · headerVoice="overline".
   */
  [/\bfrom\s+['"][^'"]*\/DataGrid['"]/g, 'DataTable with the admin configuration'],
  [/\bDataGridProps\b/g, 'DataTableProps'],
  [/\bGridColumn\b/g, 'DataTableColumn'],
  // `\b`, not a trailing character class: the scan is line by line and a JSX
  // element with props opens as `<DataGrid` at the very end of its line.
  [/<DataGrid\b/g, '<DataTable … density="admin">'],
  /*
   * Wave 2d-b — the Administration Center's second metric card. `MetricTile`
   * is now `StatisticCard layout="stacked" size="lg" labelVoice="overline"`,
   * which carries everything it did plus loading, delta and a caption. A
   * second card coming back would re-split the two areas on what a KPI
   * numeral measures, which is how they came to disagree by 2px in the first
   * place — 18px here, an arbitrary 20px there.
   */
  [/\bMetricTileProps\b/g, 'StatisticCardProps'],
  [/<MetricTile\b/g, '<StatisticCard … layout="stacked">'],
];

/** Comments may discuss the old names — that is history, not usage. */
const COMMENT = /^\s*(?:\/\/|\/\*|\*|<!--)/;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(tsx?|css)$/.test(name)) out.push(p);
  }
  return out;
}

/**
 * Arbitrary font sizes — ADR-0001 §4 / Wave 2d-a.
 *
 * `text-[Npx]` sidesteps the type scale, and the scale is the only thing
 * keeping two areas of the product agreeing on what a heading or a KPI
 * numeral measures. Wave 1 added `metric` (20px) and `micro` (10px) as the
 * two missing steps precisely to retire these, then shipped them with zero
 * consumers — the one-offs outlived the fix by an entire wave.
 *
 * Exceptions are listed, not pattern-matched: every entry is a decision
 * somebody made on purpose, and a new one should have to be argued for in
 * review rather than slipped in behind a wildcard.
 */
const ARBITRARY_SIZE = /\btext-\[(\d+)px\]/g;
const SIZE_EXCEPTIONS = new Map([
  ['components/charts/PieChart.tsx:106', 'donut centre numeral, 22px — sits between metric and h1'],
  ['components/charts/PieChart.tsx:115', 'donut centre caption, 11px — below the micro floor'],
  // Was ContentHeader.tsx:66. Moved when the three identity headers stopped
  // each inventing their own page-title size and adopted this one: keeping it
  // in the component would have meant four exceptions instead of one.
  ['components/layout/page-title.ts:29', 'page-title clamp, 16px — pending the DEBT-1b-01 type-scale decision'],
]);

/**
 * Field widths on the wrong prop — the admin toolbars, 35 call sites.
 *
 * Every text field renders through `FieldWrapper`, which is `w-full`. `className`
 * styles the CONTROL inside it, `containerClassName` styles the field. So
 * `<Select className="sm:w-44">` produces a full-width field holding a 176px
 * trigger: in a flex toolbar each filter then claims a row of its own, and the
 * Select's chevron — absolutely positioned — lands at the far right of that
 * full-width row rather than on the control. Both symptoms look like a spacing
 * problem and are not; the whole admin area's filter bars were laid out this way.
 *
 * Silent, like everything else in this file: it renders, it just renders wrong,
 * and the wrongness reads as someone's spacing choice.
 */
const FIELD_OPEN = /<(Select|Input|SearchInput|PasswordInput|Textarea)\b/g;
const FIELD_CLASSNAME = /(?<![\w])className="([^"]*)"/;
const WIDTH_UTILITY = /(?:^|\s)(?:(?:sm|md|lg|xl|2xl):)?(?:w-|min-w-|max-w-)/;

/**
 * Opening tags have to be matched across lines, not per line: a field with
 * five props spans six of them, and `className` is never on the same line as
 * the `<Select`. Scans to the tag's own `>` while stepping over `{…}` props
 * (which may contain `>` inside an arrow function) and over quoted strings.
 */
function fieldWidthFindings(rel, source) {
  const found = [];
  FIELD_OPEN.lastIndex = 0;
  let match;
  while ((match = FIELD_OPEN.exec(source)) !== null) {
    let i = match.index + match[0].length;
    let depth = 0;
    let quote = null;
    // Only what sits at the tag's own level is the field's: a `className`
    // inside a `{…}` prop — the icon in a `trailingElement` — styles
    // something else, and reading it flagged an icon's `w-5` as a field width.
    let topLevel = '';
    for (; i < source.length; i += 1) {
      const c = source[i];
      if (quote !== null) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") quote = c;
      else if (c === '{') depth += 1;
      else if (c === '}') depth -= 1;
      else if (depth === 0 && c === '>') break;
      if (depth === 0 && c !== '}') topLevel += c;
    }
    const tag = source.slice(match.index, i);
    if (tag.includes('containerClassName')) continue;
    const classes = FIELD_CLASSNAME.exec(topLevel);
    if (classes && WIDTH_UTILITY.test(classes[1] ?? '')) {
      const line = source.slice(0, match.index).split('\n').length;
      found.push(`${rel}:${line}  <${match[1]} className="${classes[1]}">`);
    }
  }
  return found;
}

const findings = [];
const sizeFindings = [];
const widthFindings = [];
const usedExceptions = new Set();

for (const file of walk(ROOT)) {
  const rel = relative(ROOT, file).replace(/\\/g, '/');
  const source = readFileSync(file, 'utf8');
  if (file.endsWith('.tsx') && !/\.test\.tsx$/.test(file)) {
    widthFindings.push(...fieldWidthFindings(rel, source));
  }
  const lines = source.split('\n');
  /*
   * Block comments have to be tracked, not sniffed line by line: a CSS token
   * comment wraps onto continuation lines that start with plain prose, and
   * the `--text-metric` docblock naming the `text-[20px]` one-offs it retires
   * was itself reported as a one-off.
   */
  let inBlock = false;
  lines.forEach((line, i) => {
    const wasInBlock = inBlock;
    const opens = line.lastIndexOf('/*');
    const closes = line.lastIndexOf('*/');
    if (opens > closes) inBlock = true;
    else if (closes > opens) inBlock = false;
    if (wasInBlock || COMMENT.test(line)) return;
    for (const [re, fix] of RETIRED) {
      re.lastIndex = 0;
      const m = re.exec(line);
      if (m) {
        findings.push(`${rel}:${i + 1}  ${m[0]}  →  use ${fix}`);
        break;
      }
    }

    ARBITRARY_SIZE.lastIndex = 0;
    const size = ARBITRARY_SIZE.exec(line);
    if (size) {
      const at = `${rel}:${i + 1}`;
      if (SIZE_EXCEPTIONS.has(at)) {
        usedExceptions.add(at);
        return;
      }
      const px = Number(size[1]);
      const suggestion = px === 20 ? 'text-metric' : px === 10 ? 'text-micro' : 'a step on the DS type scale';
      sizeFindings.push(`${at}  ${size[0]}  →  use ${suggestion}`);
    }
  });
}

if (widthFindings.length > 0) {
  console.error(`\n✖ ${widthFindings.length} field width(s) on \`className\` instead of \`containerClassName\`:\n`);
  widthFindings.forEach((f) => { console.error('  ' + f); });
  console.error('\n`className` styles the control; the field wrapper around it stays w-full.');
  console.error('The result is a full-width field holding a narrow control — every filter');
  console.error('takes a row of its own, and the Select chevron lands at the far right of');
  console.error('that row. Move the width to `containerClassName`.\n');
  process.exit(1);
}

if (sizeFindings.length > 0) {
  console.error(`\n✖ ${sizeFindings.length} arbitrary font size(s) off the type scale:\n`);
  sizeFindings.forEach((f) => { console.error('  ' + f); });
  console.error('\nThe scale is what keeps the admin and doctor areas agreeing on what a');
  console.error('KPI numeral measures. If a size is genuinely intentional, add it to');
  console.error('SIZE_EXCEPTIONS in this script with the reason.\n');
  process.exit(1);
}

/*
 * A stale exception is its own defect: it says a decision still stands when
 * the line it pinned has moved or been fixed, and the next person to add a
 * one-off inherits a guard with a hole in it.
 */
const stale = [...SIZE_EXCEPTIONS.keys()].filter((k) => !usedExceptions.has(k));
if (stale.length > 0) {
  console.error(`\n✖ ${stale.length} stale font-size exception(s) — the line no longer matches:\n`);
  stale.forEach((k) => { console.error(`  ${k}  (${SIZE_EXCEPTIONS.get(k)})`); });
  console.error('\nRemove it, or update the line number it points at.\n');
  process.exit(1);
}

if (findings.length > 0) {
  console.error(`\n✖ ${findings.length} retired design token(s) in use:\n`);
  findings.forEach((f) => { console.error('  ' + f); });
  console.error('\nThese were deleted in Wave 1b (ADR-0001 §11). They resolve to nothing,');
  console.error('or silently to a Tailwind default, so nothing else will catch this.\n');
  process.exit(1);
}
console.log(
  `✓ no retired design tokens in use · type scale clean (${String(SIZE_EXCEPTIONS.size)} declared exceptions)`,
);
