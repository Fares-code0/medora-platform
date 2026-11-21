/**
 * Does the content look like the type it was declared as? (M37.2)
 *
 * `checkUpload` validates the **declared** `Content-Type` against the
 * kind's allowlist, and the declaration is the client's word: a file
 * sent as `image/png` was stored and served as `image/png` whatever its
 * bytes were. The allowlist's own reasoning — "PNG, JPEG and WebP cannot
 * carry script", and SVG is excluded because it can — holds only for a
 * file that *is* a PNG, a JPEG or a WebP. This is the check that makes it
 * hold for the bytes as well as for the header.
 *
 * ## What it checks, and what it does not
 *
 * The leading signature each format defines, and nothing past it. A file
 * that opens like a PNG and is malformed afterwards passes; parsing is
 * the malware scanner's job (M25.3), and this is a cheap gate in front
 * of it, not a substitute for it.
 *
 * `text/csv` and `text/plain` have no signature and are accepted as they
 * come, **explicitly**. A "no NUL bytes" heuristic was considered and
 * rejected: UTF-16 text — Excel's "Unicode Text" export among it — is
 * full of NULs and is legitimate, and no browser renders a `text/*`
 * download as markup, so the heuristic would refuse real files to stop
 * nothing.
 *
 * A type with no rule here passes. Every type an allowlist names has an
 * entry, which `file-signature.spec.ts` asserts against `FILE_POLICY`, so
 * adding a type fails there until someone decides its rule.
 */

import type { PolicyViolation } from './file-policy';

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);
const ascii = (text: string): Uint8Array => Uint8Array.from(text, (char) => char.charCodeAt(0));

function startsWith(content: Uint8Array, prefix: Uint8Array, offset = 0): boolean {
  if (content.length < offset + prefix.length) return false;
  return prefix.every((value, index) => content[offset + index] === value);
}

function indexOf(content: Uint8Array, needle: Uint8Array, limit: number): number {
  const end = Math.min(content.length, limit) - needle.length;
  for (let start = 0; start <= end; start++) {
    if (startsWith(content, needle, start)) return start;
  }
  return -1;
}

const JPEG = bytes(0xff, 0xd8, 0xff);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const RIFF = ascii('RIFF');
const WEBP = ascii('WEBP');
const PDF = ascii('%PDF-');

/**
 * ISO 32000 puts `%PDF-` on the first line, but Acrobat documents that it
 * accepts the header anywhere in the first 1024 bytes, and real files
 * arrive with bytes in front of it (scanner and mail-gateway prefixes).
 * The rule searches that window rather than refusing files every reader
 * opens.
 */
const PDF_HEADER_WINDOW = 1024;

/** No signature exists for plain text; see the header. */
const ANY_TEXT = (): boolean => true;

export const SIGNATURE_RULES: Readonly<Record<string, (content: Uint8Array) => boolean>> = {
  'image/jpeg': (content) => startsWith(content, JPEG),
  'image/png': (content) => startsWith(content, PNG),
  'image/webp': (content) => startsWith(content, RIFF) && startsWith(content, WEBP, 8),
  'application/pdf': (content) => indexOf(content, PDF, PDF_HEADER_WINDOW) !== -1,
  'text/csv': ANY_TEXT,
  'text/plain': ANY_TEXT,
};

/**
 * The content check, pure like `checkUpload`, and run after it: a file of
 * the wrong *kind* is told that first.
 */
export function checkSignature(
  mimeType: string,
  content: Uint8Array,
  field = 'file',
): PolicyViolation | null {
  const type = mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
  const rule = SIGNATURE_RULES[type];

  if (rule === undefined || rule(content)) return null;

  return { field, message: `The file's content is not ${type}` };
}
