import { describe, expect, it } from 'vitest';

import { checkUpload, FILE_POLICY } from './file-policy';
import { FILE_KINDS } from './file-storage.types';

/**
 * Per-kind upload rules (RM M25.1, API §17.1).
 *
 * > ✅ Verify: wrong MIME for kind → 422.
 *
 * The 422 is asserted at the route in `files.e2e-spec.ts`; what is
 * asserted here is the rule that produces it, exhaustively and without a
 * server — including the two cases a hand-written check usually misses:
 * a `Content-Type` carrying a parameter, and an upload of zero bytes.
 */
describe('every kind has a policy', () => {
  it.each(FILE_KINDS)('%s', (kind) => {
    const policy = FILE_POLICY[kind];

    expect(policy.mimeTypes.length).toBeGreaterThan(0);
    expect(policy.maxBytes).toBeGreaterThan(0);
  });

  it('never accepts SVG anywhere', () => {
    // An SVG is a document that can carry script, and a branding asset
    // is served to every user on the sign-in page. This is the assertion
    // that fails if somebody adds it to the image list for convenience.
    for (const kind of FILE_KINDS) {
      expect(FILE_POLICY[kind].mimeTypes, kind).not.toContain('image/svg+xml');
    }
  });

  it('keeps the profile-photo rule M9.2 already shipped', () => {
    // Transcribed, not chosen: `PUT /me/profile/photo` has enforced
    // exactly this since M9, and a policy table that quietly widened it
    // would change a live route's behaviour.
    expect(FILE_POLICY.profile_photo.mimeTypes).toEqual([
      'image/jpeg',
      'image/png',
      'image/webp',
    ]);
    expect(FILE_POLICY.profile_photo.maxBytes).toBe(5 * 1024 * 1024);
  });
});

describe('checkUpload', () => {
  it('accepts a file that matches its kind', () => {
    expect(checkUpload('patient_document', 'application/pdf', 1024)).toBeNull();
  });

  it('refuses a type the kind does not allow', () => {
    const violation = checkUpload('branding_asset', 'application/pdf', 1024);

    expect(violation?.field).toBe('file');
    expect(violation?.message).toContain('image/png');
  });

  it('reads a Content-Type with parameters', () => {
    // Browsers send `image/jpeg; charset=binary` and a naive equality
    // check refuses a perfectly ordinary photograph.
    expect(checkUpload('profile_photo', 'image/jpeg; charset=binary', 1024)).toBeNull();
    expect(checkUpload('profile_photo', 'IMAGE/JPEG', 1024)).toBeNull();
  });

  it('refuses an empty upload', () => {
    // A zero-byte file is a failed upload, and storing it would put an
    // id in a clinical record pointing at nothing.
    expect(checkUpload('patient_document', 'application/pdf', 0)?.message).toContain('empty');
  });

  it('refuses a file over its kind ceiling, and names the ceiling', () => {
    const violation = checkUpload('branding_asset', 'image/png', 3 * 1024 * 1024);

    expect(violation?.message).toContain('2 MB');
  });

  it('reports the type before the size', () => {
    // Somebody who sent the wrong kind of file entirely should be told
    // that, not told their spreadsheet is too large to be a logo.
    const violation = checkUpload('branding_asset', 'text/csv', 50 * 1024 * 1024);

    expect(violation?.message).toContain('must be one of');
  });

  it('accepts a file exactly at the ceiling', () => {
    expect(checkUpload('branding_asset', 'image/png', 2 * 1024 * 1024)).toBeNull();
  });

  it('names the field the caller sent it in', () => {
    expect(checkUpload('profile_photo', 'application/pdf', 10, 'photo')?.field).toBe('photo');
  });
});
