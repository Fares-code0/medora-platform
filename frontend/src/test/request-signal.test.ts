import { describe, expect, it } from 'vitest';

/**
 * Pins the `Request` shim in `setup.ts`: a data router's navigation carries
 * jsdom's `AbortSignal` into Node's `Request`, and the router reads
 * `request.signal.aborted` to drop an interrupted navigation. The shim must
 * therefore accept that signal *and* keep its abort, not merely stop throwing.
 */
describe('Request accepts the environment’s AbortSignal (setup.ts shim)', () => {
  it('constructs with a jsdom signal instead of throwing', () => {
    const controller = new AbortController();
    expect(
      () => new Request('http://localhost/doctor', { signal: controller.signal }),
    ).not.toThrow();
  });

  it('forwards an abort that happens after construction', () => {
    const controller = new AbortController();
    const request = new Request('http://localhost/doctor', { signal: controller.signal });
    expect(request.signal.aborted).toBe(false);

    controller.abort('navigation interrupted');

    expect(request.signal.aborted).toBe(true);
    expect(request.signal.reason).toBe('navigation interrupted');
  });

  it('carries an abort that happened before construction', () => {
    const controller = new AbortController();
    controller.abort('already gone');

    const request = new Request('http://localhost/doctor', { signal: controller.signal });

    expect(request.signal.aborted).toBe(true);
    expect(request.signal.reason).toBe('already gone');
  });

  it('builds a request with no signal as before', () => {
    const request = new Request('http://localhost/doctor', { method: 'POST', body: 'x' });
    expect(request.method).toBe('POST');
    expect(request.signal.aborted).toBe(false);
  });
});
