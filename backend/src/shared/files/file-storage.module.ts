import { Module } from '@nestjs/common';

import { ConfigService } from '../../config';
import { DatabaseModule } from '../database';

import { ClamAvMalwareScanner } from './clamav-malware-scanner';

import { FILE_STORAGE } from './file-storage.types';
import { MALWARE_SCANNER, type MalwareScannerPort } from './malware-scanner.types';
import { ProfilePhotoUrls } from './profile-photo-urls';
import { S3FileStorage } from './s3-file-storage';
import { UnconfiguredMalwareScanner } from './unconfigured-malware-scanner';

/**
 * Binds `FILE_STORAGE` to the S3-compatible adapter (RM M25.2/M25.4).
 *
 * This one line **is** M25.4's retro-wiring. Every consumer — profile
 * photos, patient documents, record and lab attachments, message
 * attachments, verification documents, branding assets and report
 * exports — injects the port and needed no change, which is the return
 * on ADR-019 §2's decision to define the port at M2 and stub it.
 *
 * `UnconfiguredFileStorage` is kept, not deleted: it is what
 * `module-graph.e2e-spec.ts` asserts the failure *shape* against, and it
 * remains the honest binding for any deployment that has no object
 * store. The adapter answers 503 with the same code when the store is
 * unreachable, so the contract a caller sees is identical either way.
 *
 * `MALWARE_SCANNER` joined at M30.2, bound to the adapter that scans
 * nothing. That is the honest binding for a platform with no engine: the
 * sweep runs, every file is reported `unavailable`, and the download
 * gate M25.3 built stays closed. Binding ClamAV or a provider is a
 * second implementation of the port and one line here — see
 * `malware-scanner.types.ts`.
 *
 * `ProfilePhotoUrls` joined with the profile-photo fix: the one place a
 * stored doctor photo becomes a signed, scan-gated URL. It reads `files`,
 * hence `DatabaseModule`.
 */
@Module({
  imports: [DatabaseModule],
  providers: [
    { provide: FILE_STORAGE, useClass: S3FileStorage },
    {
      // ClamAV when `CLAMAV_HOST` names a clamd (M25.3); otherwise the
      // unconfigured scanner, which writes no verdict and keeps every
      // file `pending` (RA-M30.2). No sweep, gate or download surface
      // names an engine, so this binding is the whole switch.
      provide: MALWARE_SCANNER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): MalwareScannerPort => {
        const clamav = config.clamav;
        return clamav === null
          ? new UnconfiguredMalwareScanner()
          : new ClamAvMalwareScanner(clamav);
      },
    },
    ProfilePhotoUrls,
  ],
  exports: [FILE_STORAGE, MALWARE_SCANNER, ProfilePhotoUrls],
})
export class FileStorageKernelModule {}
