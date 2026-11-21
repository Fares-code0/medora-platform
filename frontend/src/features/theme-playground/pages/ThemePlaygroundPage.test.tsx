import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '@/app/providers';

import { WEB_TOKENS } from '../model/tokens';

import { ThemePlaygroundPage } from './ThemePlaygroundPage';

/*
 * Vitest stubs CSS imports to '' — even `?raw` — so the Original preset would
 * parse as empty. Hand the module the real stylesheet instead.
 */
vi.mock('@/styles/tokens.css?raw', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  return { default: fs.readFileSync(path.join(process.cwd(), 'src/styles/tokens.css'), 'utf8') };
});

const TOKENS_CSS = readFileSync(join(process.cwd(), 'src/styles/tokens.css'), 'utf8');

/**
 * `--color-primary` as tokens.css writes it for one mode, following at most one
 * `var(--…)` hop to the literal it names. Deliberately independent of the
 * resolver under test, so the assertion is "the playground shows the colour
 * the stylesheet declares", whichever form (literal or palette reference) the
 * stylesheet uses.
 */
function declaredPrimary(css: string, mode: 'light' | 'dark'): string {
  const body = (selector: string) => {
    const at = css.indexOf(`\n${selector} {`);
    return at < 0 ? '' : css.slice(at, css.indexOf('}', at));
  };
  const scopes = mode === 'light' ? [body(':root')] : [body('.dark'), body(':root')];
  const lookup = (name: string) =>
    scopes.map((b) => new RegExp(String.raw`--${name}:\s*([^;]+);`).exec(b)?.[1]?.trim()).find(Boolean) ?? '';
  const value = lookup('color-primary');
  const reference = /^var\(--([a-z0-9-]+)\)$/.exec(value)?.[1];
  return reference ? lookup(reference) : value;
}

const PRIMARY_LIGHT = declaredPrimary(TOKENS_CSS, 'light');
const PRIMARY_DARK = declaredPrimary(TOKENS_CSS, 'dark');

function renderPage() {
  return render(
    <MemoryRouter>
      <AppProviders>
        <ThemePlaygroundPage />
      </AppProviders>
    </MemoryRouter>,
  );
}

const pane = (mode: 'light' | 'dark') => screen.getByTestId(`theme-preview-${mode}`);
const varOf = (mode: 'light' | 'dark', name: string) => pane(mode).style.getPropertyValue(name);

/*
 * Query cost. The page is ~2,800 elements: one editor row per token and two
 * full preview galleries. A page-wide `getByRole` checks the visibility of
 * every candidate (761ms for one textbox, measured alone; `getByLabelText`
 * took 14.5s), and a loaded suite multiplies that past any sane limit. So:
 *
 * - `section(label)` finds a labelled section directly, and role queries run
 *   `within` it (48ms for the same kind of lookup);
 * - `control(label, role)` finds a token row's control by its unique
 *   `aria-label` and asserts its role and accessible name explicitly.
 *
 * Each still fails if its target is missing, duplicated, or has the wrong role
 * or name. The assertions about the page are unchanged.
 */
function only<T extends Element>(selector: string): T {
  const found = document.querySelectorAll<T>(selector);
  expect(found, selector).toHaveLength(1);
  return found[0]!;
}
const section = (label: string) => only<HTMLElement>(`section[aria-label="${label}"]`);
function control(label: string, role: 'textbox' | 'button') {
  const element = only<HTMLElement>(`[aria-label="${label}"]`);
  expect(element).toHaveRole(role);
  expect(element).toHaveAccessibleName(label);
  return element;
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.className = '';
  document.documentElement.removeAttribute('style');
});

// The 15s limit predates the scoped queries above (ADR-0005's ten roles had
// pushed page-wide queries past vitest's 5s default). It stays as headroom for
// the render itself under a loaded suite; the queries no longer need it.
describe('Theme Playground', { timeout: 15_000 }, () => {
  it('opens on Original Medora, scoped to the two preview panes', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Theme Playground' })).toBeInTheDocument();
    expect(PRIMARY_LIGHT).toMatch(/^#[0-9a-f]{6}$/);
    expect(PRIMARY_DARK).toMatch(/^#[0-9a-f]{6}$/);
    expect(varOf('light', '--color-primary')).toBe(PRIMARY_LIGHT);
    expect(varOf('dark', '--color-primary')).toBe(PRIMARY_DARK);
    // Every token is declared on the scope, so nothing leaks in from <html>.
    for (const token of WEB_TOKENS) {
      expect(varOf('light', token), token).not.toBe('');
      expect(varOf('dark', token), token).not.toBe('');
    }
  });

  it('switches presets live', async () => {
    renderPage();
    await userEvent.click(within(section('Theme presets')).getByRole('button', { name: /Medical Blue/ }));
    expect(varOf('light', '--color-primary')).toBe('#0b5cad');
    expect(varOf('dark', '--color-primary')).toBe('#8cbcf0');
  });

  it('forks an edit into a Custom Theme without touching the real theme or preferences', () => {
    renderPage();
    const field = control('Primary value', 'textbox');
    fireEvent.change(field, { target: { value: '#aa3300' } });

    expect(varOf('light', '--color-primary')).toBe('#aa3300');
    expect(within(section('Theme presets')).getByRole('button', { name: /Custom \(from Original Medora\)/ })).toHaveAttribute('aria-pressed', 'true');

    // The app's own theme is untouched: no variable on <html>, no stored preference.
    expect(document.documentElement.style.getPropertyValue('--color-primary')).toBe('');
    expect(window.localStorage.getItem('medora.theme')).toBeNull();
    const keys = Object.keys(window.localStorage);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) expect(key.startsWith('medora.dev.theme-playground.')).toBe(true);
  });

  it('keeps a half-typed value out of the preview', () => {
    renderPage();
    fireEvent.change(control('Primary value', 'textbox'), { target: { value: '#aa33' } });
    // `#aa33` is valid 4-digit hex; `#aa3` is too. A non-colour is the case that must not land:
    fireEvent.change(control('Primary value', 'textbox'), { target: { value: '#zz' } });
    expect(varOf('light', '--color-primary')).toBe('#aa33');
    expect(screen.getByText(/Not a colour/)).toBeInTheDocument();
  });

  it('reports a contrast failure with its ratio and offers — but does not apply — a fix', async () => {
    renderPage();
    fireEvent.change(control('Text Tertiary value', 'textbox'), { target: { value: '#d0d4da' } });
    const checks = section('Accessibility checks, light mode');
    expect(checks).toHaveRole('region');
    expect(within(checks).getAllByText(/--color-text-tertiary on --color-surface is \d\.\d\d:1/).length).toBeGreaterThan(0);
    expect(varOf('light', '--color-text-tertiary')).toBe('#d0d4da');

    const [fix] = within(checks).getAllByRole('button', { name: /^Use #/ });
    await userEvent.click(fix!);
    expect(varOf('light', '--color-text-tertiary')).not.toBe('#d0d4da');
  });

  describe('Copy', () => {
    const setClipboard = (value: unknown) =>
      Object.defineProperty(navigator, 'clipboard', { value, configurable: true, writable: true });
    afterEach(() => setClipboard(undefined));

    it('confirms a successful copy and copies the real value', async () => {
      const writeText = vi.fn(() => Promise.resolve());
      setClipboard({ writeText });
      renderPage();
      await userEvent.click(control('Copy Primary value', 'button'));
      expect(await screen.findByText('Value copied')).toBeInTheDocument();
      expect(writeText).toHaveBeenCalledWith(PRIMARY_LIGHT);
    });

    it('explains the fallback when the Clipboard API is missing, without claiming success', async () => {
      setClipboard(undefined);
      renderPage();
      await userEvent.click(within(section('Export')).getByRole('button', { name: /^Copy CSS variables/ }));
      expect(await screen.findByText('Clipboard not available')).toBeInTheDocument();
      expect(screen.queryByText(/copied/)).toBeNull();
      // The playground is still alive and editable.
      expect(control('Primary value', 'textbox')).toBeInTheDocument();
    });

    it('reports a refused permission as a failure', async () => {
      setClipboard({ writeText: vi.fn(() => Promise.reject(new DOMException('denied', 'NotAllowedError'))) });
      renderPage();
      await userEvent.click(control('Copy Primary value', 'button'));
      expect(await screen.findByText('Copy was blocked')).toBeInTheDocument();
      expect(screen.queryByText('Value copied')).toBeNull();
    });
  });

  it('exports every token', () => {
    renderPage();
    const output = screen.getByTestId('theme-export-output').textContent ?? '';
    for (const token of WEB_TOKENS) expect(output).toContain(`${token}: `);
  });
});
