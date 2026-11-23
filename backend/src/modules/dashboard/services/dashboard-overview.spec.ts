import { describe, expect, it, vi } from 'vitest';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { CacheService } from '../../../shared/cache';
import type { DashboardRepository } from '../repositories/dashboard.repository';

import type { ActionQueueService } from './action-queue.service';
import { DashboardService } from './dashboard.service';

/**
 * `DashboardService.overview`'s flight key is the caller's authorization
 * scope (RM M31.1). The e2e spec proves the burst and the two-doctor case
 * over HTTP; this proves the case HTTP cannot stage concurrently — one
 * account whose capabilities changed between two tokens.
 */
function service() {
  const cache = new CacheService({
    mget: () => Promise.reject(new Error('unused')),
    write: () => Promise.resolve(),
    bump: () => Promise.resolve(),
  });
  const dashboard = new DashboardService(
    {} as DashboardRepository,
    {} as ActionQueueService,
    cache,
  );
  const composite = vi
    .spyOn(dashboard, 'composite')
    .mockImplementation(
      (user) => new Promise((resolve) => setTimeout(() => resolve({ for: user.id } as never), 20)),
    );
  return { dashboard, composite };
}

const user = (permissions: string[], role = 'doctor'): AuthenticatedUser => ({
  id: 'u1',
  publicId: 'usr_1',
  role,
  permissions,
  sessionId: 's1',
});

describe('DashboardService.overview', () => {
  it('coalesces the same scope, whatever order the capabilities arrive in', async () => {
    const { dashboard, composite } = service();

    await Promise.all([
      dashboard.overview(user(['records.view', 'labs.review'])),
      dashboard.overview(user(['labs.review', 'records.view'])),
    ]);

    expect(composite).toHaveBeenCalledTimes(1);
  });

  it('does not coalesce one account across two authorization versions', async () => {
    // The live authz_version, not the token's permission claim, scopes the
    // flight: a claim can be stale for a token's lifetime (§2.8).
    const { dashboard, composite } = service();

    await Promise.all([
      dashboard.overview({ ...user(['records.view', 'labs.review']), authzVersion: 3 }),
      dashboard.overview({ ...user(['records.view', 'labs.review']), authzVersion: 4 }),
    ]);

    expect(composite).toHaveBeenCalledTimes(2);
  });

  it('does not coalesce one account across two roles', async () => {
    const { dashboard, composite } = service();

    await Promise.all([
      dashboard.overview(user([], 'doctor')),
      dashboard.overview(user([], 'admin')),
    ]);

    expect(composite).toHaveBeenCalledTimes(2);
  });
});
