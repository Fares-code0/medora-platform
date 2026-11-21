import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setPreference } from '@/services/preferences';

/**
 * The no-flash theme boot script — FRONTEND_ARCHITECTURE.md §11.
 *
 * The script is inline in index.html because it has to run before first
 * paint, which means it cannot import the module that owns the storage
 * format. That gap is where it broke: `services/preferences.ts` JSON-encodes
 * every value, so `medora.theme` holds `"dark"` with the quotes, while the
 * script compared the raw item to 'dark'. It never matched. Dark mode still
 * worked — ThemeProvider applied it after mount — so the failure was
 * invisible to every existing test and surfaced only as a light flash on
 * every load, the one thing the script exists to prevent.
 *
 * These tests therefore execute the real script, extracted from the real
 * index.html, rather than re-implementing its decision: a copy would have
 * passed just as happily while the shipped file stayed broken. Storage is
 * seeded through `setPreference` wherever the value is a legal one, so the
 * two sides cannot drift apart again without failing here.
 */

const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');

/** The first inline <script> in <head> — the boot script. */
function extractBootScript(): string {
  const match = /<script>([\s\S]*?)<\/script>/.exec(html);
  if (match?.[1] === undefined) throw new Error('no inline boot script found in index.html');
  return match[1];
}

/**
 * Runs the boot script against the current jsdom document and storage.
 *
 * The Function constructor is the point rather than a shortcut: the script
 * ships as inline HTML, so the only way to test what actually runs in a
 * browser is to evaluate that exact text. Importing a shared helper instead
 * would test a second copy of the logic and leave index.html unguarded —
 * which is precisely how the original defect survived.
 */
function runBootScript(): void {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call -- see above
  new Function(extractBootScript())();
}

function setSystemPrefersDark(prefersDark: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: prefersDark && query === '(prefers-color-scheme: dark)',
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

const isDark = (): boolean => document.documentElement.classList.contains('dark');

describe('no-flash theme boot script', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
  });

  it('writes the theme preference JSON-encoded', () => {
    // The contract the script has to match, asserted at its source rather
    // than assumed. If `setPreference` ever stops encoding, this fails here
    // instead of silently reintroducing the flash.
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    setPreference('theme', 'dark');

    expect(setItem).toHaveBeenCalledWith('medora.theme', '"dark"');
  });

  it('applies .dark before paint for a stored dark preference', () => {
    setPreference('theme', 'dark');
    setSystemPrefersDark(false);

    runBootScript();

    expect(isDark()).toBe(true);
  });

  it('leaves .dark off for a stored light preference, even when the OS is dark', () => {
    setPreference('theme', 'light');
    setSystemPrefersDark(true);

    runBootScript();

    expect(isDark()).toBe(false);
  });

  it('follows the OS when the stored preference is system', () => {
    setPreference('theme', 'system');

    setSystemPrefersDark(true);
    runBootScript();
    expect(isDark()).toBe(true);

    document.documentElement.className = '';
    setSystemPrefersDark(false);
    runBootScript();
    expect(isDark()).toBe(false);
  });

  it('follows the OS when nothing is stored', () => {
    setSystemPrefersDark(true);
    runBootScript();
    expect(isDark()).toBe(true);

    document.documentElement.className = '';
    setSystemPrefersDark(false);
    runBootScript();
    expect(isDark()).toBe(false);
  });

  it('falls back to the OS when the stored value cannot be parsed', () => {
    // A hand-edited or legacy unquoted value, so JSON.parse throws.
    // `getPreference` returns null for it and ThemeProvider resolves
    // 'system', so the script has to land on the OS rather than honour the
    // raw string. The OS is light here precisely so the two answers differ:
    // the old script read this as 'dark' and applied the class.
    localStorage.setItem('medora.theme', 'dark');
    setSystemPrefersDark(false);

    expect(() => runBootScript()).not.toThrow();
    expect(isDark()).toBe(false);
  });

  it('does not throw when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    setSystemPrefersDark(true);

    // ThemeProvider resolves 'system' in this case too, so the script must
    // still reach the OS preference rather than bailing out to light.
    expect(() => runBootScript()).not.toThrow();
    expect(isDark()).toBe(true);
  });
});

/**
 * The same script's second block, which applies the appearance and
 * accessibility settings. It is the direct neighbour of the theme read that
 * broke, and it reads the same storage through the same service — so it was
 * the first place the encoding bug could plausibly have spread. It parses its
 * value rather than comparing the raw item, which is why it did not; these
 * tests record that as a checked property instead of an assumption, and cover
 * the clamp the theme block has no equivalent of.
 */
describe('no-flash interface boot script', () => {
  beforeEach(() => {
    localStorage.clear();
    const root = document.documentElement;
    root.removeAttribute('style');
    for (const name of Object.keys(root.dataset)) delete root.dataset[name];
    // The interface block runs after the theme block, so the OS preference
    // has to resolve even though nothing here asserts on `.dark`.
    setSystemPrefersDark(false);
  });

  it('applies the settings as the app actually stores them', () => {
    setPreference('interface', {
      density: 'compact',
      textScale: 120,
      reduceMotion: true,
      highContrast: true,
      focusRings: 'high',
      keyboardNav: true,
    });

    runBootScript();

    const root = document.documentElement;
    expect(root.dataset.density).toBe('compact');
    expect(root.dataset.contrast).toBe('high');
    expect(root.dataset.focus).toBe('high');
    expect(root.dataset.keyboardNav).toBe('on');
    expect(root.dataset.reduceMotion).toBe('on');
    expect(root.style.getPropertyValue('--font-scale')).toBe('1.2');
  });

  it('clamps a text scale stored outside the supported 90–130 range', () => {
    setPreference('interface', {
      density: 'comfortable',
      textScale: 500,
      reduceMotion: false,
      highContrast: false,
      focusRings: 'default',
      keyboardNav: false,
    });

    runBootScript();

    expect(document.documentElement.style.getPropertyValue('--font-scale')).toBe('1.3');
  });

  it('leaves the defaults alone when nothing is stored', () => {
    runBootScript();

    expect(document.documentElement.dataset.density).toBeUndefined();
    expect(document.documentElement.style.getPropertyValue('--font-scale')).toBe('');
  });
});
