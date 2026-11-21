import type { InputJsonObject } from '@prisma/client/runtime/client';

import type { PrismaClient } from '../../src/generated/prisma/client';

/**
 * The eleven platform-settings slices (RM M5.10, DB §L1).
 *
 * Seeded in **every** environment, production included: the security
 * slice is what M6's lockout and session handling read (ADR-020: "M6's
 * limiter, 2FA step-up and session handling read `PolicyService.current()`,
 * not config"), and a missing row means the service falls back to
 * environment defaults that an administrator cannot see or change.
 *
 * The values are the seeded defaults ADR-007 establishes, and they match
 * `frontend/src/features/admin/admin-settings.api.ts` exactly — a backend
 * defaulting differently would silently change a policy an administrator
 * already sees on screen.
 *
 * `update: {}` throughout, deliberately. Re-running the seed must not
 * reset a slice an administrator has edited; the seed establishes a
 * baseline, it does not enforce one.
 */
export const PLATFORM_SETTINGS: Readonly<Record<string, InputJsonObject>> = {
  general: {
    platformName: 'Medora',
    supportEmail: 'support@medora.health',
    defaultSection: 'overview',
    maintenanceMode: false,
    maintenanceMessage: '',
  },
  organization: {
    name: 'Medora Clinic',
    legalName: '',
    taxId: '',
    phone: '',
    website: '',
    addressLine: '',
    city: '',
    country: '',
  },
  branding: {
    productName: 'Medora',
    tagline: '',
    loginWelcome: '',
    showPoweredBy: true,
  },
  localization: {
    language: 'en',
    timezone: 'UTC',
    dateFormat: 'MDY',
    timeFormat: '12h',
    firstDayOfWeek: 'monday',
    currency: 'USD',
  },
  notifications: {
    emailEnabled: true,
    smsEnabled: false,
    inAppEnabled: true,
    dailyDigest: false,
    criticalOnly: false,
    quietFrom: '22:00',
    quietTo: '07:00',
  },
  // ADR-007's established session and password policy. M6 reads this
  // slice rather than the environment once it exists.
  security: {
    twoFactorRequired: false,
    passwordExpiryDays: 180,
    sessionTimeoutMinutes: 30,
    loginAttemptLimit: 5,
    singleSessionPerUser: false,
  },
  email: {
    fromName: 'Medora',
    fromAddress: 'no-reply@medora.health',
    replyTo: '',
    smtpHost: '',
    smtpPort: 587,
    signature: '',
  },
  sms: { enabled: false, senderId: '', defaultCountryCode: '', deliveryReports: false },
  backup: { autoBackup: true, frequency: 'daily', retainCount: 5 },
  // ADR-007's four established retention periods. `autoPurge: false` is
  // the rule, not a placeholder: R1 says retention expiry deletes nothing
  // unless an administrator turns this on.
  retention: {
    patientRecordYears: 10,
    auditLogDays: 365,
    messageDays: 180,
    autoPurge: false,
  },
  privacy: {
    productAnalytics: true,
    errorReporting: true,
    cookieBanner: true,
    dpaAccepted: false,
  },
};

export async function seedPlatformSettings(prisma: PrismaClient): Promise<number> {
  for (const [key, value] of Object.entries(PLATFORM_SETTINGS)) {
    await prisma.platformSetting.upsert({
      where: { key },
      create: { key, value },
      // Never overwrite an administrator's edit.
      update: {},
    });
  }

  return Object.keys(PLATFORM_SETTINGS).length;
}
