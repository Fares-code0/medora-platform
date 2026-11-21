import { Module } from '@nestjs/common';

import { AuditKernelModule } from '../audit';
import { DatabaseModule } from '../database';

import { EnvelopeReencryptionService } from './envelope-reencryption.service';
import { EnvelopeService } from './envelope.service';
import { ReencryptionLock } from './reencryption.lock';

/**
 * Application-layer encryption at rest (RM M2.3, DB §10).
 *
 * Promoted out of `modules/auth/` at **M24** for the reason
 * `MailKernelModule` was promoted at M6 (ADR-025): a second module needs
 * it and no module may import another. `platform_integrations.config_enc`
 * is write-only encrypted credentials (§19.5) and `user_credentials`'
 * TOTP secret is the same problem with a different table, so the cipher
 * has to sit below both.
 *
 * Unlike the other kernels this one has no port and no token. There is
 * nothing to swap: AES-256-GCM over `DATA_ENCRYPTION_KEY` is the
 * decision, not an implementation of one, and a second implementation
 * behind a token would be a second way to encrypt the same column.
 *
 * `EnvelopeReencryptionService` (M37, key rotation) sits here rather than
 * in a domain module because it rewrites every module's envelope columns,
 * and the list of those columns belongs beside the cipher that wrote them.
 * `ReencryptionLock` is its advisory lock, on a connection of its own.
 * It imports the database and audit kernels explicitly, as
 * `ActivityKernelModule` does, rather than leaning on the shared kernel
 * being `@Global`.
 */
@Module({
  imports: [DatabaseModule, AuditKernelModule],
  providers: [EnvelopeService, EnvelopeReencryptionService, ReencryptionLock],
  exports: [EnvelopeService, EnvelopeReencryptionService],
})
export class CryptoKernelModule {}
