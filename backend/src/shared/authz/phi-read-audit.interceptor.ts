/**
 * Mandatory audit of PHI reads (multi-hospital §2.13, fix-list item 15).
 *
 * Every successful read of a route guarded by a PHI capability
 * (`PHI_CAPABILITIES`: clinical records, lab review, clear identity, message
 * content) writes one `phi.read` ledger row: who read, which route and
 * resource, and at which hospital. It is global, so a new clinical read route
 * is audited by declaring its capability; no handler has to remember to.
 *
 * Fail closed: the row is written before the response is released, and a
 * ledger that refuses it turns the read into an error rather than an
 * unrecorded disclosure.
 */

import {
  Inject,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { from, mergeMap, type Observable } from 'rxjs';

import { AUTHENTICATED_USER, type RequestWithUser } from '../../common/auth/authenticated-user';
import { AUDIT_DISPATCHER, type AuditDispatcher } from '../audit';
import { CAN_METADATA } from './authz.decorators';
import { HospitalContextService } from './hospital-context.service';
import { PHI_CAPABILITIES, type Permission } from './permission-catalogue';

const READ_METHODS = new Set(['GET', 'HEAD']);

/** The PHI capabilities a route requires, or none. */
export function phiCapabilitiesOf(required: readonly Permission[] | undefined): Permission[] {
  return (required ?? []).filter((capability) => PHI_CAPABILITIES.includes(capability));
}

@Injectable()
export class PhiReadAuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly contexts: HospitalContextService,
    @Inject(AUDIT_DISPATCHER) private readonly audit: AuditDispatcher,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const request = context.switchToHttp().getRequest<Request & RequestWithUser>();
    if (!READ_METHODS.has(request.method)) return next.handle();

    const phi = phiCapabilitiesOf(
      this.reflector.getAllAndOverride<readonly Permission[]>(CAN_METADATA, [
        context.getHandler(),
        context.getClass(),
      ]),
    );
    const user = request[AUTHENTICATED_USER];
    if (phi.length === 0 || user === undefined) return next.handle();

    return next.handle().pipe(
      mergeMap((body: unknown) =>
        from(
          (async (): Promise<unknown> => {
            const scope = await this.contexts.forRequest(user);
            const params = (request.params ?? {}) as Record<string, string | undefined>;
            const resource = Object.values(params).find((value) => value !== undefined) ?? 'list';
            await this.audit.record({
              action: 'phi.read',
              actor: { userId: user.id, role: user.role, sessionId: user.sessionId },
              entityType: (request.route as { path?: string } | undefined)?.path ?? request.path,
              entityId: resource,
              hospitalId: scope.kind === 'hospital' ? scope.hospitalId : null,
              metadata: { capabilities: phi.join(' '), method: request.method },
            });
            return body;
          })(),
        ),
      ),
    );
  }
}
