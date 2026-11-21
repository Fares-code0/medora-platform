import { Inject, Injectable, Logger } from '@nestjs/common';

import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../database';

import { DOWNLOAD_TTL_SECONDS, FILE_STORAGE, type FileStoragePort } from './file-storage.types';
import { assertScanClean } from './scan-gate';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A stored photo reference → what goes on the wire. */
export type PhotoUrlLookup = (stored: string | null) => string | null;

/**
 * `doctors.photo_url` → a URL a browser can put in an `<img>`.
 *
 * ## What the column holds
 *
 * `PUT /me/profile/photo` stores the **`files.id`** of a `profile_photo`
 * row (see `SelfProfileRepository.setDoctorPhoto`), never a URL: a
 * signed URL expires within a minute, so a stored one would be dead by
 * the next read. Every response that carries a doctor's photo resolves
 * the id here, at the moment the view is built.
 *
 * One resolver rather than one per module because three surfaces carry
 * the same photo — the doctor's own profile, the patient doctor
 * directory, and the doctor embedded in a patient's appointment — and two
 * hand-written copies of a gate are how one of them comes to be wrong
 * (`scan-gate.ts` says the same of downloads).
 *
 * ## What comes out
 *
 *  · a `files.id` naming a live `profile_photo` that the scanner marked
 *    **clean** → a fresh `signedDownloadUrl(key, DOWNLOAD_TTL_SECONDS,
 *    { disposition: 'inline' })`. `inline` because an `<img>` must render
 *    the object, not receive a save dialog;
 *  · the same row **unscanned or infected** → `null`. The M25.3 gate
 *    applies through `assertScanClean`, the one definition of "clean" the
 *    download surfaces share. A list or profile read is not a download
 *    request, so the refusal is `null` (the client shows initials) rather
 *    than a 403 that would fail the whole response;
 *  · an id naming nothing, a deleted photo, or a file of another kind →
 *    `null`. The kind filter is what stops a `photo_url` pointed at a lab
 *    report from being signed for whoever reads the doctor;
 *  · an absolute `https:` URL → unchanged. It is not an object of ours to
 *    gate;
 *  · anything else — notably a bare storage key written before the
 *    `files` row existed, which was never scanned → `null`. An internal
 *    value never reaches the wire as though it were a URL.
 *
 * A signing failure for one photo degrades that photo to `null` and is
 * logged; it must not turn a profile or a directory page into a 503.
 *
 * ## Who may see the result
 *
 * The callers have already decided which doctors the viewer may see; this
 * does not widen that. `profile_photo` is in the files module's
 * `PUBLICLY_READABLE` set — a staff portrait is chrome, readable by any
 * signed-in user — so signing it for a patient who can see the doctor is
 * the same decision `GET /files/:id/download` already makes.
 *
 * ## One query per response
 *
 * `lookup` takes every stored value a response will carry and resolves
 * them with a single `files` query by primary key, so a directory page of
 * twenty doctors costs one statement, not twenty. Signing is local
 * computation for the S3 adapter (the signature is computed, not fetched).
 */
@Injectable()
export class ProfilePhotoUrls {
  private readonly logger = new Logger(ProfilePhotoUrls.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(FILE_STORAGE) private readonly storage: FileStoragePort,
  ) {}

  /** One stored value. */
  async resolve(stored: string | null): Promise<string | null> {
    return (await this.lookup([stored]))(stored);
  }

  /** Resolves every value up front; the returned function answers for each. */
  async lookup(stored: readonly (string | null)[]): Promise<PhotoUrlLookup> {
    const resolved = new Map<string, string | null>();
    const ids = new Set<string>();

    for (const value of stored) {
      if (value === null || resolved.has(value)) continue;

      if (value.startsWith('https://')) resolved.set(value, value);
      else if (UUID.test(value)) ids.add(value);
      else resolved.set(value, null);
    }

    if (ids.size > 0) {
      const files = await this.prisma.file.findMany({
        where: {
          id: { in: [...ids] },
          kind: 'profile_photo',
          deletedAt: null,
          storageKey: { not: '' },
        },
        select: { id: true, storageKey: true, scanResult: true },
      });

      for (const file of files) {
        resolved.set(file.id, await this.sign(file.storageKey, file.scanResult));
      }
    }

    return (value) => (value === null ? null : (resolved.get(value) ?? null));
  }

  private async sign(storageKey: string, scanResult: string | null): Promise<string | null> {
    try {
      assertScanClean(scanResult, 'file');
    } catch (error) {
      if (error instanceof AppException) return null;
      throw error;
    }

    try {
      return await this.storage.signedDownloadUrl(storageKey, DOWNLOAD_TTL_SECONDS, {
        disposition: 'inline',
      });
    } catch (error) {
      this.logger.warn({ err: error }, 'Could not sign a profile photo URL; serving none');
      return null;
    }
  }
}
