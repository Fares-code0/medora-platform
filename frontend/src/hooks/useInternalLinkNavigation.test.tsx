import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useInternalLinkNavigation } from './useInternalLinkNavigation';

/**
 * The app-wide anchor interceptor (mounted once in `AppShell`). It turns
 * plain `<a href>` from router-agnostic design-system components into SPA
 * navigations.
 *
 * Its guard used to be `href.startsWith('/')` alone, which also admits
 * `//host` and `/\host` — both read as off-site by a browser, and the
 * second is the shape React Router 6.30.4's open-redirect advisory needs
 * (GHSA-wrjc-x8rr-h8h6). Those are now left to the browser instead of
 * being passed to `navigate()`.
 */

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

/** Clicks a fresh anchor and reports whether the hook claimed the click. */
function clickAnchor(href: string): { intercepted: boolean } {
  const anchor = document.createElement('a');
  anchor.setAttribute('href', href);
  document.body.append(anchor);

  const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
  anchor.dispatchEvent(event);
  anchor.remove();

  return { intercepted: event.defaultPrevented };
}

describe('useInternalLinkNavigation', () => {
  beforeEach(() => {
    navigate.mockClear();
    renderHook(() => useInternalLinkNavigation());
  });

  it('routes a same-origin path through the router', () => {
    expect(clickAnchor('/doctor/labs').intercepted).toBe(true);
    expect(navigate).toHaveBeenCalledWith('/doctor/labs');
  });

  it('leaves a protocol-relative target to the browser', () => {
    expect(clickAnchor('//evil.example.com').intercepted).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('leaves a backslash target to the browser', () => {
    expect(clickAnchor('/\\evil.example.com').intercepted).toBe(false);
    expect(clickAnchor('/doctor/labs\\@evil.example.com').intercepted).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('leaves an absolute off-site URL to the browser', () => {
    expect(clickAnchor('https://evil.example.com').intercepted).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });
});
