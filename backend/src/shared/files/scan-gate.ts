import { AppException } from '../../common/errors/app.exception';

/**
 * The download gate (RM M25.3). `403 scan_pending` until
 * `files.scan_result = 'clean'`.
 *
 * It turns on `scan_result`, not on `scanned_at`. DB §11's column comment
 * says why: null is "not yet scanned, which is not the same as clean". A
 * gate on `scanned_at IS NOT NULL` opens for a file the scanner marked
 * **infected** — a gate that reports success on the one file it exists to
 * stop, which is the defect M25.3 found in the message download.
 *
 * An infected file gets the same code and a different message: the
 * client's branch is "you cannot have this yet", and the person deserves
 * to be told which of the two it is.
 *
 * One function, because three download surfaces enforce it (files,
 * message attachments, record attachments) and two hand-written copies of
 * a gate are how one of them came to be wrong. Every caller runs its own
 * scope check **first**: a `403 scan_pending` reachable by someone who may
 * not see the file is an existence oracle.
 *
 * `noun` keeps each surface's wording — "file" on `/files`, "attachment"
 * where the caller asked for an attachment.
 */
export function assertScanClean(scanResult: string | null, noun: 'file' | 'attachment'): void {
  if (scanResult === 'clean') return;

  if (scanResult === 'infected') {
    throw AppException.forbidden(
      `This ${noun} was rejected by the malware scan and cannot be downloaded.`,
      'scan_pending',
    );
  }

  throw AppException.forbidden(
    `This ${noun} is still being scanned. Download will activate once the scan completes.`,
    'scan_pending',
  );
}
