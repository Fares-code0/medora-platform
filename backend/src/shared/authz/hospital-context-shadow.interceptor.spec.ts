import { type CallHandler, type ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AUTHENTICATED_USER, type AuthenticatedUser } from '../../common/auth/authenticated-user';
import {
  HOSPITAL_CONTEXT,
  type RequestWithHospitalContext,
} from '../../common/auth/hospital-context';
import { HospitalContextService } from './hospital-context.service';
import { HospitalContextShadowInterceptor } from './hospital-context-shadow.interceptor';

const principal: AuthenticatedUser = {
  id: 'user-1',
  publicId: 'usr_1',
  role: 'doctor',
  permissions: [],
  sessionId: 'session-1',
};

function executionContext(request: object): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as ExecutionContext;
}

describe('HospitalContextShadowInterceptor', () => {
  it('attaches the derived context and passes through the handler result', async () => {
    const request: RequestWithHospitalContext & { [AUTHENTICATED_USER]?: AuthenticatedUser } = {
      [AUTHENTICATED_USER]: principal,
    };
    const service = {
      resolve: vi
        .fn()
        .mockResolvedValue({
          kind: 'hospital',
          hospitalId: 'hospital-a',
          source: 'doctor_employment',
        }),
    };
    const next: CallHandler = { handle: () => of('response') };
    const result = await lastValueFrom(
      new HospitalContextShadowInterceptor(service as unknown as HospitalContextService).intercept(
        executionContext(request),
        next,
      ),
    );

    expect(request[HOSPITAL_CONTEXT]).toEqual({
      kind: 'hospital',
      hospitalId: 'hospital-a',
      source: 'doctor_employment',
    });
    expect(result).toBe('response');
  });

  it('does not resolve context for a request without an authenticated principal', async () => {
    const request: RequestWithHospitalContext = {};
    const service = { resolve: vi.fn() };
    const next: CallHandler = { handle: () => of('public response') };

    await expect(
      lastValueFrom(
        new HospitalContextShadowInterceptor(
          service as unknown as HospitalContextService,
        ).intercept(executionContext(request), next),
      ),
    ).resolves.toBe('public response');
    expect(service.resolve).not.toHaveBeenCalled();
  });

  it('continues the request with unresolved context when context lookup fails', async () => {
    const request: RequestWithHospitalContext & { [AUTHENTICATED_USER]?: AuthenticatedUser } = {
      [AUTHENTICATED_USER]: principal,
    };
    const service = { resolve: vi.fn().mockRejectedValue(new Error('database unavailable')) };
    const next: CallHandler = { handle: () => of('response') };

    await expect(
      lastValueFrom(
        new HospitalContextShadowInterceptor(
          service as unknown as HospitalContextService,
        ).intercept(executionContext(request), next),
      ),
    ).resolves.toBe('response');
    expect(request[HOSPITAL_CONTEXT]).toEqual({
      kind: 'unresolved',
      reason: 'resolution_unavailable',
    });
  });

  it('does not swallow handler errors as context-resolution failures', async () => {
    const request: RequestWithHospitalContext & { [AUTHENTICATED_USER]?: AuthenticatedUser } = {
      [AUTHENTICATED_USER]: principal,
    };
    const service = {
      resolve: vi.fn().mockResolvedValue({ kind: 'unresolved', reason: 'no_active_employment' }),
    };
    const handlerError = new Error('handler failed');
    const next: CallHandler = { handle: () => throwError(() => handlerError) };

    await expect(
      lastValueFrom(
        new HospitalContextShadowInterceptor(
          service as unknown as HospitalContextService,
        ).intercept(executionContext(request), next),
      ),
    ).rejects.toBe(handlerError);
  });
});
