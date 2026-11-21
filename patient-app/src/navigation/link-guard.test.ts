import { getStateFromPath } from '@react-navigation/native';

import { isSafeLinkPath } from './link-guard';
import { linking } from './linking';

/**
 * The deep-link input guard — `docs/DEPENDENCIES.md` §4.1.
 *
 * One advisory in this tree reaches a patient's phone rather than the
 * machine that builds the app: `decode-uri-component`, reached through
 * `query-string` from `@react-navigation/core`'s `getStateFromPath`,
 * with no fix at any version. §4.1 named three things that bound it and
 * said none of them was a fix.
 *
 * These tests are about the fourth thing, which is: the parser is not
 * called at all for input it cannot survive. So the assertions come in
 * two halves —
 *
 * 1. **The predicate**, which is where the reasoning is, and
 * 2. **the wiring**, which is the half that actually protects anyone. A
 *    correct `isSafeLinkPath` that `linking.ts` forgot to call would
 *    pass every test in the first half.
 *
 * The second half asserts against the real `linking` export and drives
 * it with a spy on the module the advisory is in, so "never reached" is
 * observed rather than inferred from reading the source.
 */

describe('isSafeLinkPath — what a real link looks like', () => {
  it.each([
    'emergency',
    'home',
    'appointments',
    'appointments/APT-1',
    'doctors/DR-17',
    'messages/CV-4',
    'records/labs',
    'notifications',
    'book',
    // Well-formed escapes are what `encodeURIComponent` emits, and a
    // link carrying one must still resolve.
    'doctors/DR%2D17',
    'appointments/APT-1?from=notification',
  ])('accepts %s', (path) => {
    expect(isSafeLinkPath(path)).toBe(true);
  });
});

describe('isSafeLinkPath — the shape the advisory needs', () => {
  it.each([
    // A lone `%` is the malformed escape in its smallest form.
    '%',
    'appointments/%',
    // One hex digit is not two.
    'appointments/%A',
    // `%zz` is the classic malformed sequence.
    'appointments/%zz',
    // The pathological case: a long run of them, which is what makes
    // the decoding cost blow up rather than merely fail.
    `appointments/${'%E0%A4%A'.repeat(20)}`,
    // In the query string rather than the path — the query string is
    // the part `query-string` parses, so this is the likelier carrier.
    'appointments/APT-1?ref=%E0%A4%A',
  ])('refuses %s', (path) => {
    expect(isSafeLinkPath(path)).toBe(false);
  });

  it('refuses a path longer than any route this app declares', () => {
    // The decoder's cost is superlinear in the length of the malformed
    // run, so the length cap bounds the worst case even for input the
    // escape check would pass.
    expect(isSafeLinkPath(`doctors/${'a'.repeat(600)}`)).toBe(false);
    expect(isSafeLinkPath(`doctors/${'a'.repeat(400)}`)).toBe(true);
  });

  it('refuses rather than repairs', () => {
    // Repairing a malformed escape means deciding what a hostile author
    // meant, and guessing could route a patient to a screen showing a
    // chart. There is no "cleaned" return value to be tempted by: the
    // predicate answers yes or no.
    expect(typeof isSafeLinkPath('appointments/%zz')).toBe('boolean');
  });
});

describe('linking.ts calls the guard — the half that protects anyone', () => {
  const resolve = (path: string) =>
    linking.getStateFromPath?.(path, linking.config) ?? undefined;

  it('still resolves a legitimate link to its route', () => {
    // The guard must not have cost the app its deep links. This is the
    // assertion that would fail if `isSafeLinkPath` were tightened into
    // uselessness.
    expect(resolve('emergency')).toEqual(getStateFromPath('emergency', linking.config as never));
    expect(resolve('appointments/APT-1')).toBeDefined();
  });

  it('resolves a refused link to nothing, and does not throw', () => {
    // Nothing, not an error: the app opens where it would have opened
    // anyway. There is no action a patient can take about a link they
    // did not knowingly follow, and §4.1 already says an unmatched path
    // resolves to nothing.
    expect(() => resolve('appointments/%zz')).not.toThrow();
    expect(resolve('appointments/%zz')).toBeUndefined();
    expect(resolve(`doctors/${'a'.repeat(600)}`)).toBeUndefined();
  });

  it('never hands a malformed escape to the vulnerable parser', () => {
    // The point of the whole exercise, observed rather than inferred.
    // `decodeURIComponent` stands in for the dependency: it is what
    // `decode-uri-component` wraps and what a percent-decoding parser
    // must eventually call.
    const decode = jest.spyOn(globalThis, 'decodeURIComponent');

    try {
      resolve('appointments/%E0%A4%A');
      expect(decode).not.toHaveBeenCalled();

      // …and the spy is capable of firing, so the assertion above is
      // not passing because nothing decodes anything.
      resolve('doctors/DR%2D17');
      expect(decode).toHaveBeenCalled();
    } finally {
      decode.mockRestore();
    }
  });
});
