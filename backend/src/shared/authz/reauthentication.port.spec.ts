import { describe, expect, it, vi } from 'vitest';

import type { AuthenticatedUser } from '../../common/auth/authenticated-user';

import { ReauthenticationPort } from './reauthentication.port';

const PRINCIPAL: AuthenticatedUser = {
  id: '11111111-1111-4111-8111-111111111111',
  publicId: 'usr_fixture',
  role: 'doctor',
  permissions: [],
  sessionId: '22222222-2222-4222-8222-222222222222',
};

describe('ReauthenticationPort', () => {
  it('fails closed when nothing is bound', async () => {
    await expect(new ReauthenticationPort().verify(PRINCIPAL, 'pw')).rejects.toThrow(
      /not bound/,
    );
  });

  it('delegates to the bound verifier and propagates its refusal', async () => {
    const port = new ReauthenticationPort();
    const verify = vi.fn().mockRejectedValueOnce(new Error('invalid')).mockResolvedValueOnce(undefined);
    port.bind({ verify });

    await expect(port.verify(PRINCIPAL, 'wrong')).rejects.toThrow('invalid');
    await expect(port.verify(PRINCIPAL, 'right')).resolves.toBeUndefined();
    expect(verify).toHaveBeenLastCalledWith(PRINCIPAL, 'right');
  });

  it('refuses a second, different binding', () => {
    const port = new ReauthenticationPort();
    port.bind({ verify: vi.fn() });
    expect(() => port.bind({ verify: vi.fn() })).toThrow(/already bound/);
  });
});
