import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useShareLink } from './useShareLink';

/**
 * DEC-016: "Share" copies the record's in-app address and nothing else — it
 * grants no access, so the toast says the colleague needs their own. A copy
 * that cannot happen must still leave the user holding the link.
 */

const toast = vi.fn();
vi.mock('@/app/providers', () => ({ useToast: () => ({ toast }) }));

const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

function setClipboard(value: unknown) {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true });
}

beforeEach(() => toast.mockClear());
afterEach(() => {
  if (original) Object.defineProperty(navigator, 'clipboard', original);
  else Reflect.deleteProperty(navigator, 'clipboard');
});

const PATH = '/doctor/medical-records/MR-10002';
const URL_ = `${window.location.origin}${PATH}`;

describe('useShareLink', () => {
  it('copies the absolute in-app URL and says sharing grants no access', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    const { result } = renderHook(() => useShareLink());

    await result.current(PATH);

    expect(writeText).toHaveBeenCalledWith(URL_);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'success',
        title: 'Link copied',
        description: expect.stringMatching(/their own access/) as unknown,
      }),
    );
  });

  it('shows the link itself when the copy is refused', async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error('denied')) });
    const { result } = renderHook(() => useShareLink());

    await result.current(PATH);

    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'error',
        description: expect.stringContaining(URL_) as unknown,
      }),
    );
    expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ variant: 'success' }));
  });

  it('does not throw without a clipboard API, and still hands over the link', async () => {
    setClipboard(undefined);
    const { result } = renderHook(() => useShareLink());

    await expect(result.current(PATH)).resolves.toBeUndefined();

    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'error',
        description: expect.stringContaining(URL_) as unknown,
      }),
    );
  });
});
