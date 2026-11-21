import { describe, expect, it } from 'vitest';

import { adapterImportOffenders } from '@/test/seam-rules';

import { CurrentPasswordError } from './model/settings-service';
import { settingsService } from './service';

/**
 * The settings seam (DP-04). All eleven sections were built and every write
 * path worked — but the query layer imported the eleven service functions
 * straight out of `mock/mock-settings-service`, and `AccountSection` reached
 * in for `CurrentPasswordError` on top of that. Both are the defect
 * `docs/handoff/auth-seam.md` §1 rule 3 names, and the second is the one that
 * mattered most here: an error *class* declared in a mock is one the section
 * cannot keep catching once a real transport throws its own.
 *
 * A type alone does not keep that closed, so the rule is asserted over the
 * source tree.
 */

const USER = 'seam-test-user';

describe('the settings seam', () => {
  it('is the only route to the adapter — nothing downstream imports the mock', () => {
    expect(adapterImportOffenders(__dirname, 'mock/mock-settings-service')).toStrictEqual([]);
  });

  it('exposes the whole port, so a real adapter has a complete contract to meet', () => {
    expect(Object.keys(settingsService).sort()).toStrictEqual([
      'beginTwoFactorReenrollment',
      'beginTwoFactorSetup',
      'capabilities',
      'changePassword',
      'confirmTwoFactorReenrollment',
      'disableTwoFactor',
      'enableTwoFactor',
      'fetchSettings',
      'listVerificationDocuments',
      'recordProfileUpdate',
      'removeTrustedDevice',
      'revokeOtherSessions',
      'revokeSession',
      'saveAccount',
      'saveWorkflow',
      'submitVerificationDocument',
      'toggleIntegration',
      'updatePrivacy',
      'updateSecurity',
    ]);
  });

  it('rejects a wrong current password with the class the Account section catches', async () => {
    // The section binds this rejection to the current-password field. A
    // generic failure would mark all three fields invalid and leave the
    // doctor guessing which one the server disliked — which is why the port,
    // not the adapter, owns the class.
    await expect(
      settingsService.changePassword(USER, { current: 'not-the-password', next: 'Medora456!' }),
    ).rejects.toBeInstanceOf(CurrentPasswordError);
  });

  it('answers a write with the whole document, so the activity log cannot go stale', async () => {
    const before = await settingsService.fetchSettings(USER);
    const after = await settingsService.revokeOtherSessions(USER);

    // Every write also appends to the activity log; a method answering only
    // its own section would leave Activity showing the state before it.
    expect(after.activity.length).toBeGreaterThan(before.activity.length);
  });
});
