import { Module } from '@nestjs/common';

import {
  PlatformIntegrationController,
  PlatformSettingsController,
} from './controllers/platform-settings.controller';
import { PlatformSettingsRepository } from './repositories/platform-settings.repository';
import { ApiKeyService } from './services/api-key.service';
import { BackupService } from './services/backup.service';
import { PlatformJobs } from './services/platform.jobs';
import { HttpIntegrationProbe, INTEGRATION_PROBE } from './services/integration-probe';
import { IntegrationService } from './services/integration.service';
import { PlatformSettingsService } from './services/platform-settings.service';

/**
 * Platform Settings — API §19, RM M24.
 *
 * The sixteen admin panels holding platform-wide policy. M3.3 layers
 * these DB values over the env defaults, which is what makes
 * configuration dynamic — though the layering itself lives in
 * `shared/platform-policy/`, because lint zone 6 keeps `config/` from
 * importing the kernel that holds the database client.
 *
 * `INTEGRATION_PROBE` is bound through a token rather than instantiated
 * inline so a spec can substitute a fake without a network — and with
 * `useFactory`, because the probe's constructor takes options with
 * defaults, which Nest's injector would otherwise try to resolve. The
 * SSRF guard's first check is deliberately **not** behind the token: a
 * substituted probe must not be able to skip it. The real probe adds the
 * connect-time second check (`integration-probe.ts`).
 */
@Module({
  controllers: [PlatformSettingsController, PlatformIntegrationController],
  providers: [
    PlatformSettingsRepository,
    PlatformSettingsService,
    ApiKeyService,
    BackupService,
    IntegrationService,
    { provide: INTEGRATION_PROBE, useFactory: () => new HttpIntegrationProbe() },
    PlatformJobs,
  ],
  exports: [ApiKeyService],
})
export class PlatformSettingsModule {}
