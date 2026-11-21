import { afterEach, describe, expect, it } from 'vitest';

import { isNotConnected } from '@/api/http';

import { unconnectedPlatformSettings } from './useAdminSettingsQueries';

/**
 * The live side of the platform-settings source (RM M40.5). Reads and writes
 * alike refuse as not connected: a live build must never "save" into this
 * browser's storage and report success. (The demo side is
 * `admin-settings.api.test.ts`.)
 */

afterEach(() => {
  window.localStorage.clear();
});

describe('unconnectedPlatformSettings', () => {
  it.each([
    ['getSettings', () => unconnectedPlatformSettings.getSettings()],
    ['saveSection', () => unconnectedPlatformSettings.saveSection('general', {} as never)],
    ['resetSection', () => unconnectedPlatformSettings.resetSection('general')],
    ['toggleIntegration', () => unconnectedPlatformSettings.toggleIntegration('int-1')],
    ['revokeApiKey', () => unconnectedPlatformSettings.revokeApiKey('key-1')],
    ['createBackup', () => unconnectedPlatformSettings.createBackup()],
    ['deleteBackup', () => unconnectedPlatformSettings.deleteBackup('bk-1')],
    ['createApiKey', () => unconnectedPlatformSettings.createApiKey('CI token')],
  ] as const)('%s refuses as not connected and stores nothing', async (_name, call) => {
    const failure = await call().then(
      () => null,
      (error: unknown) => error,
    );
    expect(isNotConnected(failure)).toBe(true);
    expect(window.localStorage.length).toBe(0);
  });
});
