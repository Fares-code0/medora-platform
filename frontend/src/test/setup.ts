import '@testing-library/jest-dom/vitest';

import { transferableAbortController } from 'node:util';

import { cleanup, configure } from '@testing-library/react';
import { MotionGlobalConfig } from 'framer-motion';
import { afterEach, vi } from 'vitest';

import { ANNOUNCER_ATTRIBUTE } from '@/app/providers/toast-announcer';

/*
 * Unit tests assert what an interaction leaves behind, not how long it takes
 * to get there. Overlays play their exit before they unmount
 * (`useModalDialog`): a modal stays in the DOM for its fade, the customize
 * panel for its 700ms slide. Under the real MotionProvider that is real
 * wall-clock time in jsdom, so a suite would find a closed dialog's content
 * still present. Skipping animations makes every transition settle at once —
 * the same end state a browser reaches, without the wait. Motion timing is a
 * visual concern, reviewed in the browser.
 */
MotionGlobalConfig.skipAnimations = true;

/*
 * The toast announcer (F-18) repeats every toast's title and description in
 * a visually hidden live region, by design — that copy is what a screen
 * reader hears. Text queries aimed at the visible toast would otherwise find
 * two elements (measured: 12 tests in 7 files). The announcer has its own
 * tests, which query it by this attribute; role queries are unaffected.
 */
configure({
  defaultIgnore: `script, style, [${ANNOUNCER_ATTRIBUTE}], [${ANNOUNCER_ATTRIBUTE}] *`,
});

/**
 * Global test setup. Unmounts React trees between tests and provides the
 * browser APIs jsdom lacks but the shell depends on (`matchMedia` for
 * `useMediaQuery`, `IntersectionObserver`/`ResizeObserver` for motion and
 * layout primitives).
 */

afterEach(() => {
  cleanup();
});

if (!window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  });
}

class StubObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] {
    return [];
  }
}

window.IntersectionObserver ??= StubObserver as unknown as typeof IntersectionObserver;
window.ResizeObserver ??= StubObserver as unknown as typeof ResizeObserver;

/**
 * jsdom implements no object URLs, so `utils/export`'s `download` helper —
 * the tail of every real export in the app — throws before it can run. The
 * stubs return a plausible URL and drop the revoke, which is enough for a
 * test to exercise an export end to end instead of mocking the exporter out
 * and asserting on the mock.
 *
 * Assigned only when absent, so a real implementation (or a test's own spy)
 * always wins.
 */
const objectUrls = URL as unknown as {
  createObjectURL?: (object: Blob | MediaSource) => string;
  revokeObjectURL?: (url: string) => void;
};

objectUrls.createObjectURL ??= (object) =>
  `blob:medora/${'type' in object ? object.type : 'stream'}`;
objectUrls.revokeObjectURL ??= () => undefined;

/**
 * jsdom does not implement the `download` attribute, so the anchor `download`
 * clicks is treated as a *navigation* to the `blob:` URL above — which jsdom
 * also does not implement, and which it reports from a timer, so the error
 * surfaces in whichever test happens to still be running when the timer fires
 * rather than in the one that exported anything.
 *
 * A real browser saves the file and does not navigate. Swallowing the
 * navigation for anchors that carry `download` is therefore the accurate
 * behaviour rather than a workaround, and it is narrow: a click on any other
 * anchor still goes through jsdom untouched.
 */
window.HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) {
  if (this.hasAttribute('download')) return;
  /*
   * Reached through `Reflect.apply` rather than a saved reference: jsdom
   * declares `click` once, on `HTMLElement`, and holding that inherited method
   * in a variable is the unbound-method hazard the rule below is right about
   * in general. Here the receiver is supplied in the same expression that
   * reads the method, which is the safe form the rule cannot distinguish.
   */
  // eslint-disable-next-line @typescript-eslint/unbound-method -- applied with `this` immediately
  Reflect.apply(window.HTMLElement.prototype.click, this, []);
};

/**
 * jsdom implements no `scrollIntoView`, and the design-system `Select` scrolls
 * its active option into view the moment its listbox opens — so without this
 * every test that changes a `Select` throws inside an effect before it can
 * reach an option. Here rather than in one suite's own preamble, because that
 * is a property of jsdom and of the design system, not of any one screen.
 *
 * Assigned only when absent, so a real implementation (or a test's own spy)
 * always wins.
 */
const elements = Element.prototype as { scrollIntoView?: () => void };
elements.scrollIntoView ??= () => undefined;

/**
 * jsdom has no canvas backend, and says so at length: `getContext` is
 * implemented as a "Not implemented" notice on the virtual console, printing a
 * stack trace wherever a component asks for a drawing context
 * (`ProfilePhotoField` does, to crop an upload).
 *
 * Returning `null` is not a workaround, it is the accurate answer — jsdom *is*
 * a browser that cannot create a context, and `null` is exactly what a real
 * one returns in that case, so callers take their no-canvas path for the true
 * reason rather than a mocked one.
 *
 * Assigned rather than `??=` because jsdom does define `getContext`; a test's
 * own `vi.spyOn` still wins.
 */
HTMLCanvasElement.prototype.getContext = () => null;

/**
 * Vitest's jsdom environment replaces `AbortController`/`AbortSignal` with
 * jsdom's, but leaves `Request` as Node's own (undici). A data router builds
 * every navigation as `new Request(url, { signal })`, so the two meet.
 *
 * - **Node 20** (CI) accepts the signal, so this mismatch passed unnoticed.
 * - **Node 24** (observed 2026-11-13; `engines` allows `>=20`) brand-checks
 *   it and throws "Expected signal to be an instance of AbortSignal". The
 *   navigation dies, and the page never leaves where it was
 *   (`NewMedicalRecordPage.test.tsx`, "a record created without its note…").
 *
 * In a browser both classes come from one realm, so this is a property of the
 * test environment, not of the app. The fix is Node 20's behaviour, made
 * explicit: a foreign signal is mirrored by a native one that aborts with it,
 * and a native signal passes through untouched.
 *
 * The router reads `request.signal.aborted` to drop an interrupted
 * navigation, including one waiting on a `lazy` route, so the abort is
 * forwarded rather than the signal dropped.
 */
const NodeRequest = globalThis.Request;
const NativeAbortSignal = transferableAbortController().signal.constructor;

globalThis.Request = class RequestAcceptingJsdomSignals extends NodeRequest {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    const signal = init?.signal;
    if (!signal || signal instanceof NativeAbortSignal) {
      super(input, init);
      return;
    }
    const native = transferableAbortController();
    if (signal.aborted) {
      native.abort(signal.reason);
    } else {
      signal.addEventListener('abort', () => native.abort(signal.reason), { once: true });
    }
    super(input, { ...init, signal: native.signal });
  }
};
