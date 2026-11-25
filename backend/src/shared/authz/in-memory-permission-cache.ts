/**
 * The M7 placeholder for `PERMISSION_CACHE`.
 *
 * RM M7.1 says Redis. There is no Redis client in the project yet, so
 * this is a per-process map with a TTL — which is enough to make the
 * resolver's read-through and invalidation paths real and tested, and
 * not enough to be the thing that ships.
 *
 * **Not a substitute for Redis.** It is per-process, so with more than
 * one instance an invalidation on one leaves the others serving a stale
 * effective-permission set until the TTL expires. That is a revocation
 * that does not take, which is why the TTL below is short and why the
 * swap is not optional before multi-instance deployment (M31).
 */

import { Injectable } from '@nestjs/common';

import type { Permission, PermissionCache } from './authz.types';

/**
 * Deliberately well under the 15-minute access-token life of API §1.2.
 *
 * §5 rule 4 says permission changes take effect at next session issue.
 * A cache entry outliving the token would push that boundary out past
 * the one the contract states — a revoked capability would survive a
 * re-login. Five minutes keeps the cache strictly inside the window the
 * token already defines.
 */
export const PERMISSION_CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  readonly permissions: readonly Permission[];
  readonly expiresAt: number;
}

@Injectable()
export class InMemoryPermissionCache implements PermissionCache {
  private readonly entries = new Map<string, CacheEntry>();

  constructor(
    private readonly ttlMs: number = PERMISSION_CACHE_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  get(userId: string): Promise<readonly Permission[] | undefined> {
    const entry = this.entries.get(userId);
    if (entry === undefined) return Promise.resolve(undefined);

    if (entry.expiresAt <= this.now()) {
      // Dropped on read rather than swept: an expired entry that stayed
      // in the map would keep a departed user's permissions resident.
      this.entries.delete(userId);
      return Promise.resolve(undefined);
    }

    return Promise.resolve(entry.permissions);
  }

  set(userId: string, permissions: readonly Permission[]): Promise<void> {
    this.entries.set(userId, {
      permissions,
      expiresAt: this.now() + this.ttlMs,
    });

    return Promise.resolve();
  }

  /**
   * Drops every entry of this user. Keys are `user|role|vN` (see
   * `cacheKeyFor`), so this is a prefix match; a bare user id still matches
   * for callers that key by user alone.
   */
  forget(userId: string): Promise<void> {
    for (const key of [...this.entries.keys()]) {
      if (key === userId || key.startsWith(`${userId}|`)) this.entries.delete(key);
    }

    return Promise.resolve();
  }

  async forgetMany(userIds: readonly string[]): Promise<void> {
    for (const userId of userIds) await this.forget(userId);
  }

  clear(): Promise<void> {
    this.entries.clear();

    return Promise.resolve();
  }

  /** Test seam — the number of live entries. */
  get size(): number {
    return this.entries.size;
  }
}
