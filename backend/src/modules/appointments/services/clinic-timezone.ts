/**
 * The clinic's IANA timezone, from `platform_settings`.
 *
 * ## Why a port rather than a direct query
 *
 * `platform_settings` belongs to the platform-settings module (M24), and
 * RM M2.2 zone 1 forbids a module from importing a sibling — "a module
 * that needs another module's data queries it through its own
 * repository". This is that repository, narrowed to the single key this
 * module needs, behind an interface so M24 can replace it with the real
 * settings service without touching a call site.
 *
 * ## Why it is read rather than assumed
 *
 * The seed sets `localization.timezone` to `UTC`, and it would be easy to
 * hardcode that. But an operator changes it the day the clinic is
 * configured, and a hardcoded value would then be silently wrong on every
 * appointment screen — the failure mode audit R-12 describes, where the
 * server and the client disagree about what "today" means.
 *
 * ## Falling back rather than failing
 *
 * A missing or malformed setting answers `UTC`. Every timestamp on the
 * wire is already UTC, so this is the value that makes the client render
 * exactly what the server stored — the honest degradation. Throwing
 * instead would take the appointment list down over a display preference.
 */

import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../shared/database';

export interface ClinicTimezoneSource {
  current(): Promise<string>;
}

export const CLINIC_TIMEZONE = Symbol('CLINIC_TIMEZONE');

/** `platform_settings` is keyed by slice; localization holds the zone. */
const LOCALIZATION_KEY = 'localization';
const FALLBACK = 'UTC';

@Injectable()
export class PlatformClinicTimezone implements ClinicTimezoneSource {
  constructor(private readonly prisma: PrismaService) {}

  async current(): Promise<string> {
    const row = await this.prisma.db.platformSetting.findUnique({
      where: { key: LOCALIZATION_KEY },
      select: { value: true },
    });

    const value: unknown = row?.value;
    if (typeof value !== 'object' || value === null) return FALLBACK;

    const timezone: unknown = (value as Record<string, unknown>)['timezone'];

    return typeof timezone === 'string' && timezone.length > 0 ? timezone : FALLBACK;
  }
}
