import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildPresets } from './presets';
import { previewStyle } from './preview-style';
import { COPIED_TOKEN_NAMES, COPIED_TOKENS, WEB_TOKENS } from './tokens';

const PRESETS = buildPresets(readFileSync(join(__dirname, '../../../styles/tokens.css'), 'utf8'));
const blue = PRESETS.find((p) => p.id === 'medical-blue')!;

describe('the preview scope', () => {
  const style = previewStyle(blue.light, 'light', {}) as Record<string, string>;

  it('declares every editable token with the playground value', () => {
    for (const token of WEB_TOKENS) expect(style[token], token).toBe(blue.light[token]);
  });

  /*
   * A copy declared only on `:root` is computed there, from the APP's
   * colours, and inherited already resolved — so it would ignore the
   * playground. Re-declared on the preview as the same reference, it resolves
   * against the preview's own source value instead.
   */
  it('re-declares each copy as a reference to its source, so it follows edits', () => {
    for (const name of COPIED_TOKEN_NAMES) {
      expect(style[name], name).toBe(`var(${COPIED_TOKENS[name].source})`);
    }
  });

  it('follows an edited source — the copy is a reference, not a snapshot', () => {
    const edited = previewStyle({ ...blue.light, '--color-primary': '#123456' }, 'light', {}) as Record<string, string>;
    expect(edited['--color-primary']).toBe('#123456');
    expect(edited['--color-secondary']).toBe('var(--color-primary)');
  });
});
