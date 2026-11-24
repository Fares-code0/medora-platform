import fs from 'node:fs';
import path from 'node:path';

import Feather from '@expo/vector-icons/Feather';
import { I18nManager } from 'react-native';

import { Icon, mirrorsInRtl, resolveGlyph } from '@/components/Icon';
import { renderWithProviders } from '@/test/render';

/**
 * Right-to-left — checklist S-08.
 *
 * The row asks for two things: **no mirrored-icon errors** and **no
 * horizontal overflow**. They are different kinds of claim and this file
 * treats them differently, which is the point of the split below.
 *
 * ── Mirrored icons: asserted directly ────────────────────────────────
 *
 * A disclosure chevron means *forward*, and forward is left in an RTL
 * layout. `Icon` resolves that from `I18nManager.isRTL`, so both
 * directions can be rendered and compared in a test — no device needed.
 *
 * ── Overflow: asserted structurally, because Jest has no layout ───────
 *
 * Whether Arabic text overflows a row is a measurement, and there is no
 * device here (the same blocker W-08's cold-start and scroll budgets
 * carry). What CAN be checked is the property that makes overflow
 * possible in the first place: a fixed width on a container that holds
 * text, or a physical `marginLeft`/`paddingRight` that does not flip.
 * React Native mirrors `flexDirection: 'row'`, `marginStart` and
 * `paddingHorizontal` automatically; it does not mirror `marginLeft`.
 *
 * So the scans below are the guard, and `docs/A11Y_AUDIT.md` records
 * what still needs a phone.
 */

const SRC = path.resolve(__dirname, '..');

/** Every source file that renders something, excluding the tests. */
function componentSources(): { file: string; source: string }[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) files.push(full);
    }
  };
  walk(SRC);

  return files
    .filter((file) => !file.includes(`${path.sep}test${path.sep}`))
    .map((file) => ({ file: path.relative(SRC, file), source: fs.readFileSync(file, 'utf8') }));
}

const SOURCES = componentSources();

describe('directional icons mirror with the layout (S-08)', () => {
  it('points forward to the right in a left-to-right layout', () => {
    expect(resolveGlyph('forward', false)).toBe('chevron-right');
    expect(resolveGlyph('back', false)).toBe('chevron-left');
  });

  it('points forward to the LEFT in a right-to-left layout', () => {
    // This is the mirrored-icon error the row names, in one assertion:
    // a chevron that keeps pointing right in Arabic is pointing back.
    expect(resolveGlyph('forward', true)).toBe('chevron-left');
    expect(resolveGlyph('back', true)).toBe('chevron-right');
  });

  it('leaves a non-directional icon alone in both', () => {
    // `search` and `bell` are objects, not directions. Mirroring them
    // would be the opposite error, and just as visible.
    expect(resolveGlyph('search', true)).toBe(resolveGlyph('search', false));
    expect(resolveGlyph('bell', true)).toBe(resolveGlyph('bell', false));
  });

  it('actually hands the mirrored glyph to Feather, not merely resolves it', () => {
    // `resolveGlyph` being right proves nothing if `Icon` ignores it, so
    // this reads the name `Icon` passed down. `UNSAFE_getByType` rather
    // than a query on the output: jest-expo mocks `@expo/vector-icons`
    // to a bare `<Text />`, so the glyph never reaches the rendered tree
    // and the props on the element are the only evidence there is.
    const glyphFor = (name: 'forward' | 'chevronLeft', rtl: boolean): unknown => {
      const was = I18nManager.isRTL;
      Object.defineProperty(I18nManager, 'isRTL', { value: rtl, configurable: true });
      try {
        const view = renderWithProviders(<Icon name={name} label="Open" />);
        return view.UNSAFE_getByType(Feather).props.name;
      } finally {
        Object.defineProperty(I18nManager, 'isRTL', { value: was, configurable: true });
      }
    };

    expect(glyphFor('forward', false)).toBe('chevron-right');
    expect(glyphFor('forward', true)).toBe('chevron-left');
    expect(glyphFor('forward', true)).toBe(glyphFor('chevronLeft', false));
  });

  it('mirrors the send glyph in a right-to-left layout, and nothing else', () => {
    // Feather's paper plane flies up and to the RIGHT — the reading
    // direction in English, backwards in Arabic — and has no left-facing
    // twin to swap to, so it is flipped rather than renamed.
    expect(mirrorsInRtl('send', true)).toBe(true);
    expect(mirrorsInRtl('send', false)).toBe(false);
    expect(mirrorsInRtl('search', true)).toBe(false);
    expect(mirrorsInRtl('forward', true)).toBe(false);

    const styleFor = (rtl: boolean): unknown => {
      const was = I18nManager.isRTL;
      Object.defineProperty(I18nManager, 'isRTL', { value: rtl, configurable: true });
      try {
        const view = renderWithProviders(<Icon name="send" label="Send" />);
        return view.UNSAFE_getByType(Feather).props.style;
      } finally {
        Object.defineProperty(I18nManager, 'isRTL', { value: was, configurable: true });
      }
    };

    expect(styleFor(true)).toEqual({ transform: [{ scaleX: -1 }] });
    expect(styleFor(false)).toBeUndefined();
  });
});

describe('nothing hard-codes a reading direction', () => {
  it('uses the semantic names, never a bare chevronRight or chevronLeft', () => {
    // `Icon` still knows both glyphs — it needs them to resolve `forward`
    // — but a screen naming one has decided which way the reader moves,
    // which is exactly the decision it must not make.
    // `icon="chevronLeft"` on a `Button` is the same decision through a
    // different prop: the booking flow's Back button carried one until
    // 2026-11-23 and pointed forward in Arabic.
    const offenders = SOURCES.filter(
      ({ file, source }) =>
        file !== path.join('components', 'Icon.tsx') &&
        /(name|icon)=["{']*chevron(Right|Left)/.test(source),
    ).map(({ file }) => file);

    expect(offenders).toEqual([]);
  });

  it('uses no physical margin or padding that RTL cannot flip', () => {
    // `marginStart`/`marginEnd` and `paddingHorizontal` flip with the
    // layout; `marginLeft` and `paddingRight` do not. One of the latter
    // in a list row is a rule or an indent that stays on the wrong side
    // in Arabic. Found this way rather than by eye, because there is no
    // device to look at.
    const offenders = SOURCES.filter(({ source }) =>
      /\b(margin|padding)(Left|Right)\s*:/.test(source),
    ).map(({ file }) => file);

    expect(offenders).toEqual([]);
  });

  it('aligns no text to a physical side', () => {
    // `textAlign: 'left'` is left in Arabic too. `'start'`/`'end'`, or
    // no alignment at all, follow the reader.
    const offenders = SOURCES.filter(({ source }) =>
      /textAlign:\s*'(left|right)'/.test(source),
    ).map(({ file }) => file);

    expect(offenders).toEqual([]);
  });
});

describe('nothing constrains a row to a width that Arabic could exceed', () => {
  it('sets no fixed width on anything that holds text', () => {
    // The overflow failure mode: a container sized in points for the
    // English string, holding a longer Arabic one. The exceptions are
    // allowed and named, because none of them holds text — a checkbox
    // box, a shadow offset, a square touch target and three dots.
    const ALLOWED = [
      path.join('components', 'form', 'Checkbox.tsx'),
      path.join('theme', 'spacing.ts'),
      // A 44pt square is the minimum touch target, not a text container:
      // the composer's attach and send controls hold one icon each and
      // must stay square in both directions (S-04).
      path.join('features', 'ai', 'components', 'AiComposer.tsx'),
      // Three 6pt dots. Nothing in them is text in any language.
      path.join('features', 'ai', 'components', 'AiTypingIndicator.tsx'),
    ];

    const offenders = SOURCES.filter(
      ({ file, source }) => !ALLOWED.includes(file) && /\bwidth:\s*\d/.test(source),
    ).map(({ file }) => file);

    expect(offenders).toEqual([]);
  });
});
