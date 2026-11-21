import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CriticalNotice } from './CriticalNotice';

/**
 * The critical notice carries its severity in a red icon and its title — not
 * in a coloured card edge (Medora uses none, by design) and not in a red
 * flood. It remains an alert, and it keeps everything inside it.
 */
const EDGE = /\bbefore:bg-|\bborder-[sltrbe]-(error|warning|success|info|primary|accent|secondary)\b|\bborder-[sltrbe]-(\[\d+px\]|[2-8])\b/;

describe('CriticalNotice', () => {
  it('is an alert with its title, its content and a red icon', () => {
    render(
      <CriticalNotice title="2 critical alerts need your attention">
        <p>Mona Adel — CBC critical value</p>
      </CriticalNotice>,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('2 critical alerts need your attention');
    expect(alert).toHaveTextContent('Mona Adel — CBC critical value');
    expect(alert.querySelector('svg')?.getAttribute('class')).toContain('text-error');
  });

  it('has no coloured card edge and no red background', () => {
    render(<CriticalNotice title="Critical">content</CriticalNotice>);
    const alert = screen.getByRole('alert');
    expect(alert.className).not.toMatch(EDGE);
    expect(alert.className).not.toMatch(/\bbg-error/);
    expect(alert.className).toContain('border-border');
  });
});
