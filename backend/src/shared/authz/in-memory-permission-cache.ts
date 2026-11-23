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

import type { CachedPermissions, PermissionCache } from './authz.types';

/**
 * How long an entry lives (ms).
 *
 * Since G4 (ADR-047) the TTL is not what bounds staleness — an entry is
 * used only at the permission version it was stamped with, so a change
 * applies on the next request whatever the TTL. Five minutes now only
 * bounds how long an idle account's entry stays resident.
 */
export const PERMISSION_CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  readonly entry: CachedPermissions;
  readonly expiresAt: number;
}

@Injectable()
export class InMemoryPermissionCache implements PermissionCache {
  private readonly entries = new Map<string, CacheEntry>();

  constructor(
    private readonly ttlMs: number = PERMISSION_CACHE_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  get(userId: string): Promise<CachedPermissions | undefined> {
    const entry = this.entries.get(userId);
    if (entry === undefined) return Promise.resolve(undefined);

    if (entry.expiresAt <= this.now()) {
      // Dropped on read rather than swept: an expired entry that stayed
      // in the map would keep a departed user's permissions resident.
      this.entries.delete(userId);
      return Promise.resolve(undefined);
    }

    return Promise.resolve(entry.entry);
  }

  set(userId: string, entry: CachedPermissions): Promise<void> {
    this.entries.set(userId, {
      entry: { version: entry.version, permissions: [...entry.permissions] },
      expiresAt: this.now() + this.ttlMs,
    });

    return Promise.resolve();
  }

  forget(userId: string): Promise<void> {
    this.entries.delete(userId);

    return Promise.resolve();
  }

  forgetMany(userIds: readonly string[]): Promise<void> {
    for (const userId of userIds) this.entries.delete(userId);

    return Promise.resolve();
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
