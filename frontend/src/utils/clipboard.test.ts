import { afterEach, describe, expect, it, vi } from 'vitest';

import { copyText } from './clipboard';

/**
 * `navigator.clipboard` exists only in a secure context, and `writeText`
 * may throw rather than reject. Every copy in the app goes through
 * `copyText` so neither case escapes as an uncaught error with no feedback.
 */

const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

function setClipboard(value: unknown) {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true });
}

afterEach(() => {
  if (original) Object.defineProperty(navigator, 'clipboard', original);
  else Reflect.deleteProperty(navigator, 'clipboard');
});

describe('copyText', () => {
  it('writes the text and resolves', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    await expect(copyText('hello')).resolves.toBeUndefined();
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('rejects, never throws, when the clipboard API is absent (insecure context)', async () => {
    setClipboard(undefined);
    let thrown = false;
    let promise: Promise<void> | undefined;
    try {
      promise = copyText('hello');
    } catch {
      thrown = true;
    }
    expect(thrown).toBe(false);
    await expect(promise).rejects.toThrow(/clipboard/i);
  });

  it('rejects, never throws, when writeText throws synchronously', async () => {
    setClipboard({
      writeText: () => {
        throw new Error('NotAllowedError');
      },
    });
    await expect(copyText('hello')).rejects.toThrow('NotAllowedError');
  });

  it('rejects when the write is refused', async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error('denied')) });
    await expect(copyText('hello')).rejects.toThrow('denied');
  });
});
