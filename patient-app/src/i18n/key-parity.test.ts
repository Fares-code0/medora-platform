import { ar } from './messages/ar';
import { en } from './messages/en';

/**
 * The English and Arabic catalogues carry exactly the same keys.
 *
 * The type system already makes a key missing from Arabic a compile error
 * (`Messages = Record<MessageKey, string>`). This is the runtime half, and
 * the other direction: an Arabic key that English no longer has (a
 * leftover after a rename) is caught here even if a cast ever loosens the
 * type, and an empty translation is caught too.
 */
describe('en/ar catalogue key parity', () => {
  const enKeys = Object.keys(en).sort();
  const arKeys = Object.keys(ar).sort();

  it('has no key in English that Arabic lacks', () => {
    expect(enKeys.filter((key) => !(key in ar))).toEqual([]);
  });

  it('has no key in Arabic that English lacks', () => {
    expect(arKeys.filter((key) => !(key in en))).toEqual([]);
  });

  it('has identical key sets', () => {
    expect(arKeys).toEqual(enKeys);
  });

  it('has no empty translation', () => {
    const empty = arKeys.filter((key) => (ar as Record<string, string>)[key]?.trim() === '');
    expect(empty).toEqual([]);
  });

  it('keeps every interpolation slot of the English string', () => {
    const slots = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const mismatched = enKeys.filter(
      (key) =>
        JSON.stringify(slots((en as Record<string, string>)[key] ?? '')) !==
        JSON.stringify(slots((ar as Record<string, string>)[key] ?? '')),
    );
    expect(mismatched).toEqual([]);
  });
});
