/**
 * The Settings Center — API §13.1–§13.3, RM M22.
 *
 * ## The document spans two tables and one version
 *
 * Its `updatedAt` is the later of `user_settings` and
 * `user_interface_preferences`. A per-table version would let a client
 * hold a stale privacy slice while its appearance slice looked current,
 * and the 409 §13.2 asks for would never fire for the section that was
 * actually behind.
 *
 * ## Writer hooks (M22.5) run after the write, never before
 *
 * Every slice write emits a `settings` activity row, and the **security
 * and privacy** slices additionally emit an audit event. Both are
 * after-the-fact records of a mutation that already succeeded, so both
 * go through the kernels that swallow their own failures — a feed that
 * stops recording is a real defect, just not one worth failing a
 * clinician's save over. `PrivacyActivityKind` is `privacy` rather than
 * `settings` for that slice, because the frontend groups the feed by
 * kind and a privacy change filed under "Settings" is invisible in the
 * filter a user would look in.
 *
 * ## Tokens are write-only, and the guarantee is structural
 *
 * `oauth_tokens_enc` is named by exactly one method in the repository —
 * the one that writes it. No read path selects the column, so there is
 * no projection to forget to strip, and the response-shape assertion in
 * the suite is checking a property the query plan already enforces.
 */

import { Inject, Injectable } from '@nestjs/common';

import { AppException } from '../../../common/errors/app.exception';
import { ACTIVITY_RECORDER, type ActivityRecorder } from '../../../shared/activity';
import { AUDIT_DISPATCHER, type AuditDispatcher } from '../../../shared/audit';
import {
  INTEGRATION_FROM_WIRE,
  INTEGRATION_TO_WIRE,
  SettingsRepository,
} from '../repositories/settings.repository';
import {
  SLICE_SCHEMAS,
  type IntegrationWireId,
  type SettingsSection,
} from '../dto/settings.schema';

const ACTIVITY_PAGE = 20;

/** The column defaults, as the wire spells them. */
const DEFAULT_PRIVACY = { dataSharing: true, analytics: true, cookies: true, aiDataUsage: true };
const DEFAULT_WORKFLOW = {
  landingPage: 'overview',
  defaultPatientTab: 'summary',
  defaultRecordsTab: 'all',
  autoSaveDrafts: true,
  dateFormat: 'MM/DD/YYYY',
  timeFormat: '12h',
  timezone: 'UTC',
};
const DEFAULT_APPEARANCE = {
  theme: 'system',
  locale: 'en',
  density: 'comfortable',
  sidebarCollapsed: false,
};
const DEFAULT_ACCESSIBILITY = {
  textScale: 100,
  reduceMotion: false,
  highContrast: false,
  focusRings: 'default',
  keyboardNav: false,
};

@Injectable()
export class SettingsService {
  constructor(
    private readonly settings: SettingsRepository,
    @Inject(ACTIVITY_RECORDER) private readonly activity: ActivityRecorder,
    @Inject(AUDIT_DISPATCHER) private readonly audit: AuditDispatcher,
  ) {}

  /** API §13.1 — the whole document. */
  async read(userId: string) {
    const [settings, ui, integrations, activity] = await Promise.all([
      this.settings.settings(userId),
      this.settings.interfacePreferences(userId),
      this.settings.integrations(userId),
      this.settings.activity(userId, ACTIVITY_PAGE),
    ]);

    const byId = new Map(
      integrations.map((row) => [INTEGRATION_TO_WIRE[row.integration], row] as const),
    );

    return {
      // The later of the two rows, or the epoch when neither exists —
      // an unsaved document has no version to be stale against, and a
      // client sending that value back is telling the truth.
      updatedAt: latest(settings?.updatedAt ?? null, ui?.updatedAt ?? null),
      privacy:
        settings === null
          ? DEFAULT_PRIVACY
          : {
              dataSharing: settings.privacyDataSharing,
              analytics: settings.privacyAnalytics,
              cookies: settings.privacyCookies,
              aiDataUsage: settings.privacyAiDataUsage,
            },
      workflow:
        settings === null
          ? DEFAULT_WORKFLOW
          : {
              landingPage: settings.landingPage.toLowerCase(),
              defaultPatientTab: settings.defaultPatientTab.toLowerCase(),
              defaultRecordsTab: settings.defaultRecordsTab.toLowerCase(),
              autoSaveDrafts: settings.autoSaveDrafts,
              dateFormat: settings.dateFormat,
              timeFormat: settings.timeFormat,
              timezone: settings.timezone,
            },
      appearance:
        ui === null
          ? DEFAULT_APPEARANCE
          : {
              theme: ui.theme,
              locale: ui.locale,
              density: ui.density,
              sidebarCollapsed: ui.sidebarCollapsed,
            },
      accessibility:
        ui === null
          ? DEFAULT_ACCESSIBILITY
          : {
              textScale: ui.textScale,
              reduceMotion: ui.reduceMotion,
              highContrast: ui.highContrast,
              focusRings: ui.focusRings,
              keyboardNav: ui.keyboardNav,
            },
      // Every integration is listed, connected or not: a panel that only
      // showed connected ones would give a user no way to connect the
      // rest.
      integrations: (['google-calendar', 'outlook', 'zoom', 'teams'] as const).map((id) => {
        const row = byId.get(id);

        return {
          id,
          connected: row?.connected ?? false,
          connectedAt: row?.connectedAt?.toISOString() ?? null,
          account: row?.accountLabel ?? null,
        };
      }),
      activity: activity.map((entry) => ({
        id: entry.id,
        at: entry.occurredAt.toISOString(),
        kind: entry.kind.toLowerCase(),
        summary: entry.summary,
        detail: entry.detail,
      })),
    };
  }

  /** API §13.2 — a slice update, with optimistic concurrency. */
  async patch(
    userId: string,
    section: SettingsSection,
    expectedUpdatedAt: string,
    value: unknown,
  ) {
    const parsed = SLICE_SCHEMAS[section].safeParse(value);

    if (!parsed.success) {
      // Keyed by the top-level field, and a slice-wide refinement is
      // dropped — the shape Zod 3's `error.flatten().fieldErrors` gave
      // this route, kept rather than re-decided in a dependency upgrade.
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        const [field] = issue.path;
        if (field !== undefined) (fieldErrors[String(field)] ??= []).push(issue.message);
      }
      throw AppException.validation(fieldErrors, `The ${section} settings are not valid`);
    }

    const current = await this.read(userId);

    // Compared as instants, not strings: two ISO spellings of one moment
    // are the same version, and a string comparison would 409 a client
    // that round-tripped the value through a date library.
    if (Date.parse(current.updatedAt) !== Date.parse(expectedUpdatedAt)) {
      throw AppException.conflict(
        'These settings changed since you loaded them. Reload and try again.',
      );
    }

    await this.write(userId, section, parsed.data as Record<string, unknown>);

    await this.activity.record({
      userId,
      // The feed groups by kind, so a privacy change filed under
      // "Settings" is invisible in the filter a user would look in.
      kind: section === 'privacy' ? 'privacy' : 'settings',
      summary: `${SECTION_LABEL[section]} settings updated`,
    });

    if (section === 'privacy') {
      // Security-relevant changes write both rows — one the user sees in
      // their own feed, one an administrator can correlate during an
      // incident. `shared/activity`'s header states that rule.
      await this.audit.record({
        action: 'settings.privacy_updated',
        actor: { userId, role: null },
        entityType: 'user_settings',
        entityId: userId,
        // Field names, never values: `AuditMetadata` is scalar-only by
        // design and a privacy *setting* is still the user's business.
        metadata: { fields: Object.keys(parsed.data as object).join(', ') },
      });
    }

    return this.read(userId);
  }

  /**
   * API §13.3 — connect.
   *
   * **The OAuth exchange is not implemented**, and no token is stored.
   * §13.3 says "OAuth server-side", which needs a client id, a secret
   * and a redirect URI per provider; none is configured, and no source
   * names one. Fabricating a connection would show a doctor a calendar
   * as connected that syncs nothing. So this records the *intent* and
   * refuses, and the refusal names what is missing.
   */
  connect(_userId: string, integration: IntegrationWireId): Promise<never> {
    throw new AppException(501, {
      message: `Connecting ${integration} needs an OAuth client for that provider, and none is configured. See RA-M22.1.`,
      code: 'not_implemented',
    });
  }

  /** API §13.3 — disconnect, which needs no provider to be honest. */
  async disconnect(userId: string, integration: IntegrationWireId) {
    const member = INTEGRATION_FROM_WIRE[integration];

    if (member === undefined) throw AppException.notFound('Integration not found');

    await this.settings.setIntegration(userId, member, {
      connected: false,
      connectedAt: null,
      accountLabel: null,
      // Cleared, not left in place: a disconnected integration holding
      // live credentials is a grant the user believes they revoked.
      oauthTokensEnc: null,
    });

    await this.activity.record({
      userId,
      kind: 'integration',
      summary: `Disconnected ${integration}`,
    });

    return this.read(userId);
  }

  private async write(
    userId: string,
    section: SettingsSection,
    value: Record<string, unknown>,
  ): Promise<void> {
    if (section === 'privacy') {
      await this.settings.upsertSettings(userId, {
        privacyDataSharing: value.dataSharing as boolean,
        privacyAnalytics: value.analytics as boolean,
        privacyCookies: value.cookies as boolean,
        privacyAiDataUsage: value.aiDataUsage as boolean,
      });

      return;
    }

    if (section === 'preferences') {
      await this.settings.upsertSettings(userId, {
        landingPage: (value.landingPage as string).toUpperCase() as never,
        defaultPatientTab: (value.defaultPatientTab as string).toUpperCase() as never,
        defaultRecordsTab: (value.defaultRecordsTab as string).toUpperCase() as never,
        autoSaveDrafts: value.autoSaveDrafts as boolean,
        dateFormat: value.dateFormat as string,
        timeFormat: value.timeFormat as string,
        timezone: value.timezone as string,
      });

      return;
    }

    if (section === 'appearance') {
      await this.settings.upsertInterface(userId, {
        theme: value.theme as string,
        locale: value.locale as string,
        density: value.density as string,
        sidebarCollapsed: value.sidebarCollapsed as boolean,
      });

      return;
    }

    await this.settings.upsertInterface(userId, {
      textScale: value.textScale as number,
      reduceMotion: value.reduceMotion as boolean,
      highContrast: value.highContrast as boolean,
      focusRings: value.focusRings as string,
      keyboardNav: value.keyboardNav as boolean,
    });
  }
}

const SECTION_LABEL: Record<SettingsSection, string> = {
  privacy: 'Privacy',
  preferences: 'Workflow',
  appearance: 'Appearance',
  accessibility: 'Accessibility',
};

function latest(a: Date | null, b: Date | null): string {
  const times = [a, b].filter((value): value is Date => value !== null);

  if (times.length === 0) return new Date(0).toISOString();

  return new Date(Math.max(...times.map((time) => time.getTime()))).toISOString();
}
