import { isolate, isolateLtr, withoutIsolates } from './bidi';

const LRI = '\u2066';
const FSI = '\u2068';
const PDI = '\u2069';

describe('isolate (first-strong)', () => {
  it('wraps a Latin value in FSI … PDI', () => {
    expect(isolate('Dr. Sara Ahmed')).toBe(`${FSI}Dr. Sara Ahmed${PDI}`);
  });

  it('wraps an Arabic value in FSI … PDI', () => {
    expect(isolate('مستشفى النور')).toBe(`${FSI}مستشفى النور${PDI}`);
  });

  it('keeps a mixed-script value as one unit', () => {
    const wrapped = isolate('مستشفى Al Noor');
    expect(wrapped.startsWith(FSI)).toBe(true);
    expect(wrapped.endsWith(PDI)).toBe(true);
    expect(withoutIsolates(wrapped)).toBe('مستشفى Al Noor');
  });

  it('returns an empty string for an empty value, not a bare pair', () => {
    expect(isolate('')).toBe('');
  });

  it('does not wrap an already isolated value again', () => {
    const once = isolate('Al Noor');
    expect(isolate(once)).toBe(once);
  });

  it('wraps two adjacent isolates separately rather than mistaking them for one', () => {
    const joined = `${isolate('A')} ${isolate('B')}`;
    expect(isolate(joined)).toBe(`${FSI}${joined}${PDI}`);
  });
});

describe('isolateLtr', () => {
  it('wraps a phone number in LRI … PDI', () => {
    expect(isolateLtr('+20 100 555 0199')).toBe(`${LRI}+20 100 555 0199${PDI}`);
  });

  it('returns an empty string for an empty value', () => {
    expect(isolateLtr('')).toBe('');
  });

  it('does not wrap an already isolated value again', () => {
    const once = isolateLtr('+20 100 555 0199');
    expect(isolateLtr(once)).toBe(once);
  });

  it('still wraps a value that is isolated the other way, so its direction is forced', () => {
    expect(isolateLtr(isolate('123'))).toBe(`${LRI}${FSI}123${PDI}${PDI}`);
  });
});

describe('withoutIsolates', () => {
  it('removes every isolate control and nothing else', () => {
    expect(withoutIsolates(`${LRI}a${FSI}b${PDI}${PDI}`)).toBe('ab');
    expect(withoutIsolates('plain')).toBe('plain');
    expect(withoutIsolates('')).toBe('');
  });

  it('round-trips both helpers', () => {
    expect(withoutIsolates(isolate('نور'))).toBe('نور');
    expect(withoutIsolates(isolateLtr('123'))).toBe('123');
  });
});
