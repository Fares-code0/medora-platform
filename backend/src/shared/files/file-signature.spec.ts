import { describe, expect, it } from 'vitest';

import { FILE_POLICY } from './file-policy';
import { checkSignature, SIGNATURE_RULES } from './file-signature';

/**
 * The content behind a declared type (M37.2, file-upload abuse).
 *
 * The route-level 422s are asserted in `files.e2e-spec.ts` and
 * `doctor-profile.e2e-spec.ts`; the rules are asserted here, one real
 * header and one impostor per type.
 */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x24, 0, 0, 0]),
  Buffer.from('WEBPVP8 '),
]);
const PDF = Buffer.from('%PDF-1.7\n%âãÏÓ\n');
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const HTML = Buffer.from('<!doctype html><script>alert(1)</script>');

describe('every type an allowlist names has a signature rule', () => {
  it('leaves no allowed type unchecked', () => {
    // A type added to FILE_POLICY without a rule would pass on its
    // declaration alone — the gap this file exists to close.
    const allowed = new Set(Object.values(FILE_POLICY).flatMap((policy) => policy.mimeTypes));

    for (const type of allowed) expect(SIGNATURE_RULES[type], type).toBeDefined();
  });
});

describe('checkSignature', () => {
  it.each([
    ['image/png', PNG],
    ['image/jpeg', JPEG],
    ['image/webp', WEBP],
    ['application/pdf', PDF],
    ['text/csv', Buffer.from('analyte,value\nHbA1c,6.1\n')],
    ['text/plain', Buffer.from('Results attached.')],
  ])('accepts real %s content', (type, content) => {
    expect(checkSignature(type, content)).toBeNull();
  });

  it.each([
    ['image/png', SVG],
    ['image/png', HTML],
    ['image/jpeg', PNG],
    [
      'image/webp',
      Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('AVI ')]),
    ],
    ['application/pdf', HTML],
  ])('refuses %s whose bytes are something else', (type, content) => {
    expect(checkSignature(type, content)).toEqual({
      field: 'file',
      message: `The file's content is not ${type}`,
    });
  });

  it('refuses a PNG signature cut short', () => {
    expect(checkSignature('image/png', PNG.subarray(0, 4))).not.toBeNull();
  });

  it('finds a PDF header behind leading bytes, inside the 1024-byte window only', () => {
    expect(
      checkSignature('application/pdf', Buffer.concat([Buffer.alloc(512, 0x20), PDF])),
    ).toBeNull();
    expect(
      checkSignature('application/pdf', Buffer.concat([Buffer.alloc(1024, 0x20), PDF])),
    ).not.toBeNull();
  });

  it('accepts UTF-16 text, which a NUL-byte heuristic would have refused', () => {
    const utf16 = Buffer.from('\ufeffanalyte\tvalue\n', 'utf16le');
    expect(checkSignature('text/plain', utf16)).toBeNull();
  });

  it('reads a Content-Type with parameters, and names the field it is given', () => {
    expect(checkSignature('image/jpeg; charset=binary', JPEG)).toBeNull();
    expect(checkSignature('image/png', HTML, 'photo')?.field).toBe('photo');
  });

  it('leaves a type with no rule to the allowlist that refused it', () => {
    expect(checkSignature('application/octet-stream', HTML)).toBeNull();
  });
});
