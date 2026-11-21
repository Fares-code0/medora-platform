/**
 * Notification preferences — API §10.5, RM M19.4.
 *
 * ## Two rules, and only one of them lives here
 *
 * **`categories.security` must remain true.** The schema types it as
 * `z.literal(true)`, so a request switching it off is a 422 through the
 * ordinary validation path. DB §G7's CHECK is under that, and the reason
 * the guarantee is duplicated is the one the column records: a UI-only
 * rule is one API client away from a user who never learns their
 * password was changed. This service adds no third check — it would be a
 * third place for the rule to drift.
 *
 * **Quiet hours never suppress critical lab alerts.** That rule is not
 * here at all: it belongs to the moment a notification is *sent*, and it
 * lives in `channel-selection.ts` where the dispatcher applies it. A
 * preferences endpoint that enforced it would be enforcing it at the
 * wrong time — the user is allowed to set any window they like, and what
 * the window may not do is silence a critical result.
 *
 * ## Read returns the defaults rather than 404
 *
 * A settings screen opening on a 404 has nothing to render, and the
 * column defaults already say what an unsaved user has. The same choice
 * `AiSettingsService` made at M16.5, for the same reason.
 */

import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../shared/database';
import type { NotificationPreferencesBody } from '../dto/notification.schema';

/** The wire document of API §10.5. */
export interface NotificationPreferencesView {
  readonly channels: {
    readonly email: boolean;
    readonly sms: boolean;
    readonly push: boolean;
    readonly desktop: boolean;
    readonly inApp: boolean;
  };
  readonly quietHours: {
    readonly enabled: boolean;
    readonly from: string;
    readonly to: string;
  };
  readonly categories: Record<string, boolean>;
}

/**
 * `"HH:MM"` ⇄ a `time` column.
 *
 * Prisma represents `@db.Time` as a `Date` on 1970-01-01 **in UTC**, so
 * both directions use the UTC accessors. Reading local ones would shift
 * every clinic's quiet hours by whatever offset the server happens to
 * run in — the kind of defect that only appears once the server moves.
 */
function toTimeOfDay(value: Date): string {
  const hours = String(value.getUTCHours()).padStart(2, '0');
  const minutes = String(value.getUTCMinutes()).padStart(2, '0');

  return `${hours}:${minutes}`;
}

function fromTimeOfDay(value: string): Date {
  const [hours, minutes] = value.split(':');

  return new Date(Date.UTC(1970, 0, 1, Number(hours), Number(minutes), 0));
}

@Injectable()
export class NotificationPreferenceService {
  constructor(private readonly prisma: PrismaService) {}

  async read(userId: string): Promise<NotificationPreferencesView> {
    const row = await this.prisma.db.notificationPreference.findUnique({ where: { userId } });

    if (row === null) return DEFAULT_VIEW;

    return {
      channels: {
        email: row.channelEmail,
        sms: row.channelSms,
        push: row.channelPush,
        desktop: row.channelDesktop,
        inApp: row.channelInApp,
      },
      quietHours: {
        enabled: row.quietHoursEnabled,
        from: toTimeOfDay(row.quietFrom),
        to: toTimeOfDay(row.quietTo),
      },
      categories: {
        appointments: row.catAppointments,
        'medical-records': row.catMedicalRecords,
        laboratory: row.catLaboratory,
        pharmacy: row.catPharmacy,
        patients: row.catPatients,
        ai: row.catAi,
        system: row.catSystem,
        security: row.catSecurity,
      },
    };
  }

  /**
   * `upsert`, not `create`-then-`update`.
   *
   * The row is created lazily on first save, and two saves arriving
   * together from two tabs would otherwise race between the existence
   * check and the insert — one of them losing to a primary-key
   * violation on a screen where the user pressed Save once.
   */
  async write(
    userId: string,
    body: NotificationPreferencesBody,
  ): Promise<NotificationPreferencesView> {
    const data = {
      channelEmail: body.channels.email,
      channelSms: body.channels.sms,
      channelPush: body.channels.push,
      channelDesktop: body.channels.desktop,
      channelInApp: body.channels.inApp,
      quietHoursEnabled: body.quietHours.enabled,
      quietFrom: fromTimeOfDay(body.quietHours.from),
      quietTo: fromTimeOfDay(body.quietHours.to),
      catAppointments: body.categories.appointments,
      catMedicalRecords: body.categories['medical-records'],
      catLaboratory: body.categories.laboratory,
      catPharmacy: body.categories.pharmacy,
      catPatients: body.categories.patients,
      catAi: body.categories.ai,
      catSystem: body.categories.system,
      catSecurity: body.categories.security,
    };

    await this.prisma.db.notificationPreference.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });

    return this.read(userId);
  }
}

/** The column defaults, as the wire spells them. */
const DEFAULT_VIEW: NotificationPreferencesView = {
  channels: { email: true, sms: false, push: true, desktop: false, inApp: true },
  quietHours: { enabled: false, from: '22:00', to: '07:00' },
  categories: {
    appointments: true,
    'medical-records': true,
    laboratory: true,
    pharmacy: true,
    patients: true,
    ai: true,
    system: true,
    security: true,
  },
};
