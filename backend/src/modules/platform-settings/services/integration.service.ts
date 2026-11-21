/**
 * Connected platform services — API §19.5, RM M24.4.
 *
 * > ✅ Verify: config values are never returned after write;
 * > test-connection is SSRF-guarded.
 *
 * ## Write-only is structural, not remembered
 *
 * `platform_integrations.config_enc` is named by exactly two methods in
 * the repository: the one that writes it and the one the probe reads it
 * with. No projection that reaches a response selects the column, so
 * there is no response shape that could leak it — the same argument
 * M22 records for `oauth_tokens_enc`, and the reason the suite's
 * assertion is checking a property the query plan already enforces.
 *
 * ## The config shape is opaque, and `baseUrl` is the one exception
 *
 * Nothing in the frontend model, API §19.5 or DB §L2 states what an
 * integration's configuration contains. The map is therefore validated
 * for size and type only and encrypted whole. `baseUrl` is read here
 * because `test-connection` must have somewhere to connect to and no
 * column holds one; ADR-040 records that as a named convention rather
 * than leaving it implicit, and a config without it makes the probe a
 * 422 naming the missing key instead of a silent success.
 */

import { lookup } from 'node:dns/promises';

import { Inject, Injectable } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { AppException } from '../../../common/errors/app.exception';
import { AUDIT_DISPATCHER, type AuditDispatcher } from '../../../shared/audit';
import { EnvelopeService } from '../../../shared/crypto';
import type { IntegrationPatchBody } from '../dto/platform-settings.schema';
import {
  PlatformSettingsRepository,
  type IntegrationRow,
} from '../repositories/platform-settings.repository';
import { INTEGRATION_PROBE, type IntegrationProbe } from './integration-probe';
import { blocked, isBlockedAddress, parseProbeTarget } from './ssrf-guard';

const CONFIG_FIELD = 'config.baseUrl';

@Injectable()
export class IntegrationService {
  constructor(
    private readonly settings: PlatformSettingsRepository,
    private readonly envelope: EnvelopeService,
    @Inject(AUDIT_DISPATCHER) private readonly audit: AuditDispatcher,
    @Inject(INTEGRATION_PROBE) private readonly prober: IntegrationProbe,
  ) {}

  async list() {
    return (await this.settings.integrations()).map(toView);
  }

  /**
   * §19.5 — `PATCH`. Config is replaced whole, never merged.
   *
   * A merge would mean reading the stored credentials back into process
   * memory to combine them with the new ones, which is the one thing
   * write-only storage exists to avoid. Replacing whole also makes
   * "remove a key" expressible; a merge has no way to say it.
   */
  async update(actor: AuthenticatedUser, id: string, body: IntegrationPatchBody) {
    const current = await this.settings.integration(id);
    if (current === null) throw AppException.notFound('Integration not found');

    // §19.5's "P4 consequence summary". Disabling a *connected*
    // integration stops appointments syncing or reminders sending, and
    // nothing on the row being toggled says so — the same argument that
    // makes M24.2's security and retention slices confirmed.
    if (body.connected === false && current.connected && !body.confirm) {
      throw AppException.validation(
        {
          confirm: [
            `Disabling ${current.name} stops everything that depends on it. Confirm to continue.`,
          ],
        },
        'This change requires confirmation',
      );
    }

    const row = await this.settings.updateIntegration(
      id,
      {
        ...(body.description === undefined ? {} : { description: body.description }),
        ...(body.connected === undefined ? {} : { connected: body.connected }),
        ...(body.config === undefined
          ? {}
          : { configEnc: this.envelope.encrypt(JSON.stringify(body.config)) }),
      },
      actor.id,
    );

    if (row === null) throw AppException.notFound('Integration not found');

    await this.audit.record({
      action: 'platform_settings.integration_updated',
      actor: { userId: actor.id, role: actor.role },
      entityType: 'platform_integration',
      entityId: id,
      metadata: {
        name: current.name,
        // Which keys were written, never what they were. An API secret
        // in an audit row is the leak this column is encrypted against.
        configKeys: body.config === undefined ? null : Object.keys(body.config).sort().join(', '),
        connected: body.connected ?? null,
        confirmed: body.confirm,
        consequence: body.consequence ?? null,
      },
    });

    return toView(row);
  }

  /**
   * §19.5 — `test-connection`, and its result trail.
   *
   * The trail is the **audit ledger**, not a new table: DB §L2 defines no
   * trail relation, and every probe an administrator runs is already an
   * audited administrative action. M28's query surface is what makes it
   * readable as a trail; inventing a table here would be a second,
   * narrower ledger over the same events.
   *
   * `lastSyncAt` is deliberately left alone. A successful probe proves
   * the endpoint answers; it is not a sync, and moving a timestamp that
   * says when data last flowed would make a broken integration look
   * healthy on the panel.
   */
  async testConnection(actor: AuthenticatedUser, id: string) {
    const integration = await this.settings.integration(id);
    if (integration === null) throw AppException.notFound('Integration not found');

    const config = await this.readConfig(id);
    const raw = config['baseUrl'];

    if (typeof raw !== 'string' || raw.trim() === '') {
      throw AppException.validation(
        { [CONFIG_FIELD]: ['Set a base URL for this integration before testing it'] },
        'This integration has no endpoint to test',
      );
    }

    const target = parseProbeTarget(raw.trim(), CONFIG_FIELD);

    // A hostname is resolved and **every** answer is checked, not just
    // the first: a resolver returning one public address and one private
    // one would otherwise be a way through. Resolution failure is a
    // refusal, because an address that cannot be checked has not passed.
    if (target.literalAddress === null) {
      const addresses = await lookup(target.url.hostname, { all: true }).catch(() => null);

      if (addresses === null || addresses.length === 0) {
        throw AppException.validation(
          { [CONFIG_FIELD]: ['That host could not be resolved'] },
          'The endpoint could not be resolved',
        );
      }

      if (addresses.some((entry) => isBlockedAddress(entry.address))) throw blocked(CONFIG_FIELD);
    }

    const result = await this.prober.probe(target.url);
    const checkedAt = new Date();

    await this.audit.record({
      action: 'platform_settings.integration_tested',
      actor: { userId: actor.id, role: actor.role },
      entityType: 'platform_integration',
      entityId: id,
      metadata: {
        name: integration.name,
        // The host, not the URL: a path or query string can carry a
        // token, and the host is what an operator needs to read a trail.
        host: target.url.hostname,
        reachable: result.reachable,
        status: result.status,
        durationMs: result.durationMs,
      },
      occurredAt: checkedAt,
    });

    return {
      integrationId: id,
      reachable: result.reachable,
      status: result.status,
      durationMs: result.durationMs,
      detail: result.detail,
      checkedAt: checkedAt.toISOString(),
    };
  }

  /** Decrypts the stored config. Never reaches a response. */
  private async readConfig(id: string): Promise<Record<string, unknown>> {
    const stored = await this.settings.integrationConfig(id);

    if (stored === null) {
      throw AppException.validation(
        { [CONFIG_FIELD]: ['Set a base URL for this integration before testing it'] },
        'This integration has no endpoint to test',
      );
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(this.envelope.decrypt(stored));
    } catch {
      // A row whose ciphertext will not decrypt or will not parse is a
      // configuration defect, not a probe result. Answering 422 rather
      // than letting the throw become a 500 tells the administrator
      // which integration to re-save.
      throw AppException.validation(
        { [CONFIG_FIELD]: ['The stored configuration could not be read. Save it again.'] },
        'The stored configuration could not be read',
      );
    }

    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  }
}

function toView(row: IntegrationRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    connected: row.connected,
    lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
  };
}
