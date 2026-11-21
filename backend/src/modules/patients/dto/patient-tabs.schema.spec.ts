import { describe, expect, it } from 'vitest';

import { updateEmergencyContactSchema } from './patient-tabs.schema';

/**
 * `PATCH …/emergency-contacts/{id}` changes only what it is sent
 * (`patchOf`). Under Zod 4, `.partial()` filled in `isPrimary: false`, so
 * correcting the primary contact's phone number also demoted them.
 */
describe('updateEmergencyContactSchema', () => {
  it('does not add isPrimary to a body that did not send it', () => {
    expect(updateEmergencyContactSchema.parse({ phone: '+20 100 000 0001' })).toEqual({
      phone: '+20 100 000 0001',
    });
  });

  it('still refuses an empty body', () => {
    expect(updateEmergencyContactSchema.safeParse({}).success).toBe(false);
  });
});
