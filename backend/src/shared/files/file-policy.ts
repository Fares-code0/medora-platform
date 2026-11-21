/**
 * Per-kind upload rules (RM M25.1, API §17.1).
 *
 * > ✅ Verify: wrong MIME for kind → 422; checksum stored.
 *
 * ## These are guardrails, not product rules
 *
 * API §17.1 requires "per-kind type/size validation" and no source
 * states the numbers. That makes the *requirement* binding and the
 * *values* an engineering decision, which is the honest way to describe
 * them: a size ceiling protects the service and a type list closes an
 * upload path, and neither is a clinical or commercial rule somebody
 * decided. They live in one table so that the day a product owner does
 * state limits, there is a single place to change and one spec to
 * update.
 *
 * `profile_photo` is the exception: `image/jpeg|png|webp` at 5 MB is
 * already **shipped** by M9.2's `PUT /me/profile/photo`, so it is
 * transcribed here rather than chosen. The frontend rejects at 4 MB
 * (`ProfilePhotoField.tsx`), which is a client-side courtesy under the
 * server's ceiling and not a disagreement.
 *
 * ## SVG is absent from every image list, deliberately
 *
 * An SVG is a document that can carry script, and a branding asset is
 * served to every user on the sign-in page. Accepting one would be an
 * upload-to-stored-XSS path in the one place with the widest audience.
 * PNG, JPEG and WebP cannot carry script.
 */

import type { FileKind } from './file-storage.types';

const MB = 1024 * 1024;

const IMAGES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const DOCUMENTS = ['application/pdf', ...IMAGES] as const;

export interface KindPolicy {
  readonly mimeTypes: readonly string[];
  readonly maxBytes: number;
}

export const FILE_POLICY: Readonly<Record<FileKind, KindPolicy>> = {
  // Transcribed from M9.2, not chosen — see the header.
  profile_photo: { mimeTypes: IMAGES, maxBytes: 5 * MB },
  // A scan of an insurance card, a referral letter or a consent form.
  patient_document: { mimeTypes: DOCUMENTS, maxBytes: 25 * MB },
  record_attachment: { mimeTypes: DOCUMENTS, maxBytes: 25 * MB },
  // Laboratory reports arrive as PDFs, sometimes as photographs of a
  // printed result, and `text/csv` for raw analyser output.
  lab_attachment: { mimeTypes: [...DOCUMENTS, 'text/csv'], maxBytes: 25 * MB },
  message_attachment: { mimeTypes: [...DOCUMENTS, 'text/csv', 'text/plain'], maxBytes: 10 * MB },
  // A registration certificate or an identity document.
  verification_document: { mimeTypes: DOCUMENTS, maxBytes: 10 * MB },
  // No SVG — see the header.
  branding_asset: { mimeTypes: IMAGES, maxBytes: 2 * MB },
};

export interface PolicyViolation {
  readonly field: string;
  readonly message: string;
}

/**
 * The rule check, as a pure function returning the violation rather than
 * throwing.
 *
 * Pure because it is the part worth exhaustively testing and the part
 * three call sites share, and because a validator that throws an HTTP
 * exception cannot be used anywhere that is not an HTTP request — the
 * orphan sweep and any later import path included.
 *
 * The **type** is checked before the **size**: a caller who sent the
 * wrong kind of file entirely should be told that, not told their
 * spreadsheet is too large to be a photograph.
 */
export function checkUpload(
  kind: FileKind,
  mimeType: string,
  sizeBytes: number,
  field = 'file',
): PolicyViolation | null {
  const policy = FILE_POLICY[kind];

  // Normalised because a browser may send `image/jpeg; charset=binary`
  // and the parameter is not part of the type.
  const type = mimeType.split(';')[0]?.trim().toLowerCase() ?? '';

  if (!policy.mimeTypes.includes(type)) {
    return {
      field,
      message: `A ${kind.replace(/_/g, ' ')} must be one of ${policy.mimeTypes.join(', ')}`,
    };
  }

  // Zero bytes is refused with the size rule rather than waved through:
  // an empty upload is a failed upload, and storing it would put a file
  // id in a clinical record pointing at nothing.
  if (sizeBytes <= 0) {
    return { field, message: 'The file is empty' };
  }

  if (sizeBytes > policy.maxBytes) {
    return {
      field,
      message: `Keep a ${kind.replace(/_/g, ' ')} under ${String(Math.round(policy.maxBytes / MB))} MB`,
    };
  }

  return null;
}
