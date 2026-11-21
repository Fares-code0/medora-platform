import { describe, expect, it, vi } from 'vitest';

import { copyFeedback, copyText } from './clipboard';

describe('copyText', () => {
  it('reports a successful copy, and writes exactly the text', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    await expect(copyText('#0b5cad', { writeText })).resolves.toBe('copied');
    expect(writeText).toHaveBeenCalledWith('#0b5cad');
  });

  it('reports "unavailable" when there is no Clipboard API — and does not throw', async () => {
    await expect(copyText('#0b5cad', undefined)).resolves.toBe('unavailable');
    await expect(copyText('#0b5cad', {})).resolves.toBe('unavailable');
  });

  it('reports "denied" when the browser rejects the write', async () => {
    const writeText = vi.fn(() => Promise.reject(new DOMException('Write permission denied.', 'NotAllowedError')));
    await expect(copyText('#0b5cad', { writeText })).resolves.toBe('denied');
  });
});

describe('copyFeedback', () => {
  it('calls only a real copy a success', () => {
    expect(copyFeedback('copied', 'CSS variables')).toStrictEqual({ variant: 'success', title: 'CSS variables copied' });
    for (const outcome of ['unavailable', 'denied'] as const) {
      const feedback = copyFeedback(outcome, 'CSS variables');
      expect(feedback.variant).toBe('error');
      expect(feedback.title).not.toMatch(/copied/i);
      expect(feedback.description).toMatch(/Ctrl\+C/);
    }
  });
});
