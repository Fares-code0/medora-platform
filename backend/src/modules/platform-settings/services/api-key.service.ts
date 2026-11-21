/**
 * Programmatic access credentials — API §19.4, RM M24.3.
 *
 * > ✅ Verify: the plaintext key never appears in a second response or in
 * > the DB (grep the row); revoked key authenticates nothing.
 *
 * ## The key is shown once because it is never stored
 *
 * `api_keys` has `prefix` and `key_hash` and no column the plaintext
 * could go in (DB §L3). "Shown exactly once" is therefore a property of
 * the schema rather than a rule this service remembers to follow: there
 * is no second response that *could* carry the key, because after the
 * `create` returns, the only copy in this process is the local that goes
 * out of scope.
 *
 * ## SHA-256, not Argon2id, and the difference matters
 *
 * Passwords are hashed with Argon2id because a human chooses them and a
 * slow KDF is what buys back the missing entropy. An API key is 32 bytes
 * from `randomBytes` — 256 bits — so there is nothing to buy back, and a
 * memory-hard KDF on the verification path would turn every authenticated
 * API call into a deliberate CPU burn. SHA-256 over a value of that
 * entropy is not brute-forceable, and the comparison below is
 * constant-time so the hash cannot be recovered by timing either.
 *
 * ## What this does **not** do
 *
 * `verify()` answers whether a presented key is a live credential. It
 * does **not** grant anything: no guard consumes it, and no route accepts
 * an API key today. What an API key is *allowed to do* — its capability
 * set, its rate limit, whether it acts as a user or as the platform — is
 * specified nowhere in the contract, the roadmap or UX. Inventing an
 * authorization model for a credential that can reach a PHI API is
 * exactly the kind of guess rule 4 forbids. See **RA-M24.1**.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { AppException } from '../../../common/errors/app.exception';
import { AUDIT_DISPATCHER, type AuditDispatcher } from '../../../shared/audit';
import type { ApiKeyBody } from '../dto/platform-settings.schema';
import { PlatformSettingsRepository } from '../repositories/platform-settings.repository';

/**
 * `mdra_live_` + 6 hex — the frontend's displayed shape
 * (`admin-settings.api.ts` mints `mdra_live_<4 hex>`), widened to the
 * **exact** 16 characters `api_keys.prefix` holds. Three bytes rather
 * than four because a seventeenth character is a `22001` from the driver
 * on every issuance, not a longer prefix.
 */
const PREFIX_NAMESPACE = 'mdra_live_';
const PREFIX_BYTES = 3;
const SECRET_BYTES = 32;

@Injectable()
export class ApiKeyService {
  constructor(
    private readonly settings: PlatformSettingsRepository,
    @Inject(AUDIT_DISPATCHER) private readonly audit: AuditDispatcher,
  ) {}

  list() {
    return this.settings.apiKeys().then((rows) =>
      rows.map((row) => ({
        id: row.id,
        label: row.label,
        prefix: row.prefix,
        createdAt: row.createdAt.toISOString(),
        lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
        revoked: row.revokedAt !== null,
      })),
    );
  }

  /**
   * §19.4 — issue. The only response that will ever carry `key`.
   *
   * The secret and the prefix are generated together and the full key is
   * `prefix.secret`: a presented credential can be split on the dot, so
   * the lookup is one indexed read on `prefix` rather than a scan
   * comparing hashes.
   */
  async create(actor: AuthenticatedUser, body: ApiKeyBody) {
    const prefix = `${PREFIX_NAMESPACE}${randomBytes(PREFIX_BYTES).toString('hex')}`;
    const secret = randomBytes(SECRET_BYTES).toString('base64url');
    const key = `${prefix}.${secret}`;

    const row = await this.settings.createApiKey({
      label: body.label,
      prefix,
      keyHash: hashSecret(secret),
      createdBy: actor.id,
    });

    await this.audit.record({
      action: 'platform_settings.api_key_issued',
      actor: { userId: actor.id, role: actor.role },
      entityType: 'api_key',
      entityId: row.id,
      // The label and the prefix, never the key. The prefix is the
      // displayable fragment by design (DB §L3) and is what ties an
      // incident to the credential behind it.
      metadata: { label: row.label, prefix: row.prefix },
    });

    return {
      key,
      prefix: row.prefix,
      id: row.id,
      label: row.label,
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: null,
      revoked: false,
    };
  }

  /**
   * §19.4 — revoke.
   *
   * A second revocation of the same key is a **409**, not a silent 200:
   * the request is well-formed and the state of the world refuses it,
   * which is ADR-013's distinction, and a 200 would put a second
   * "revoked" row in the audit ledger for something that happened once.
   */
  async revoke(actor: AuthenticatedUser, id: string) {
    const existing = await this.settings.apiKey(id);

    if (existing === null) throw AppException.notFound('API key not found');

    if (!(await this.settings.revokeApiKey(id, new Date()))) {
      throw AppException.conflict('This key was already revoked');
    }

    await this.audit.record({
      action: 'platform_settings.api_key_revoked',
      actor: { userId: actor.id, role: actor.role },
      entityType: 'api_key',
      entityId: id,
      metadata: { label: existing.label, prefix: existing.prefix },
    });

    const row = await this.settings.apiKey(id);

    return {
      id,
      label: existing.label,
      prefix: existing.prefix,
      createdAt: existing.createdAt.toISOString(),
      lastUsedAt: existing.lastUsedAt?.toISOString() ?? null,
      revoked: row?.revokedAt !== null && row?.revokedAt !== undefined,
    };
  }

  /**
   * Is this presented string a live credential? `null` when it is not.
   *
   * Every rejection path answers the same way — unknown prefix, wrong
   * secret, revoked key — so a caller cannot learn which of the three it
   * was, and an attacker cannot enumerate valid prefixes by the shape of
   * the failure.
   */
  async verify(presented: string): Promise<{ id: string } | null> {
    const separator = presented.indexOf('.');
    if (separator <= 0) return null;

    const prefix = presented.slice(0, separator);
    const secret = presented.slice(separator + 1);
    if (secret.length === 0) return null;

    const credential = await this.settings.credentialFor(prefix);
    if (credential === null) return null;
    // Revocation is checked before the hash rather than after, and the
    // answer is identical either way — the check exists so a revoked
    // key cannot authenticate, not so the caller learns it existed.
    if (credential.revokedAt !== null) return null;

    return constantTimeEquals(hashSecret(secret), credential.keyHash)
      ? { id: credential.id }
      : null;
  }
}

function hashSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

/**
 * `timingSafeEqual` throws on a length mismatch, which would itself be a
 * timing signal — so the lengths are equalised first. Both operands are
 * hex SHA-256 digests, so in practice they always match; the guard is
 * for the row that a migration or a hand edit left in another shape.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');

  if (left.length !== right.length) return false;

  return timingSafeEqual(left, right);
}
