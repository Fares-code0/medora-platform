/**
 * Mandatory audit of PHI reads (multi-hospital §2.13; audit F-02, F-03).
 *
 * For every successful read of a route classified `@PhiRead(resource)`
 * (see `phi-read.decorator.ts`), one `phi.read` event is written through
 * `MandatoryAuditWriter` **before** the response is released: who read,
 * which route and resource, and at which hospital. If the write fails the
 * response is replaced by a 503 `audit_unavailable` and the body is never
 * sent. A route whose handler writes its own disclosure event
 * (`auditedByHandler`) is not audited twice, but runs inside the same
 * attribution (`audit-attribution.ts`), so its own event names the reader's
 * hospital and session. An unclassified or `@NotPhi` route writes nothing.
 *
 * A failed read (any exception from the handler) writes nothing: no
 * disclosure happened.
 */

import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { from, mergeMap, Observable, of } from 'rxjs';

import {
  AUTHENTICATED_USER,
  type AuthenticatedUser,
  type RequestWithUser,
} from '../../common/auth/authenticated-user';
import { type AuditAttribution, MandatoryAuditWriter, runWithAuditAttribution } from '../audit';
import { runAsSystem } from '../database';
import { PHI_READ_METADATA, type PhiReadSpec } from './phi-read.decorator';
import { TenantContextResolver } from './tenant-context.resolver';

@Injectable()
export class PhiReadAuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly disclosures: MandatoryAuditWriter,
    private readonly tenants: TenantContextResolver,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const spec = this.reflector.getAllAndOverride<PhiReadSpec | undefined>(PHI_READ_METADATA, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (spec === undefined) return next.handle();

    const request = context.switchToHttp().getRequest<Request & RequestWithUser>();
    const user = request[AUTHENTICATED_USER];
    if (user === undefined) return next.handle();

    return from(this.attributionOf(user)).pipe(
      mergeMap(
        (attribution) =>
          // The handler runs inside the attribution, so a disclosure event it
          // writes itself is attributed like the interceptor's own.
          new Observable<unknown>((subscriber) =>
            runWithAuditAttribution(attribution, () => next.handle().subscribe(subscriber)),
          ).pipe(
            mergeMap((body: unknown) =>
              spec.auditedByHandler
                ? of(body)
                : from(this.recordRead(request, user, spec, attribution).then(() => body)),
            ),
          ),
      ),
    );
  }

  /** The hospital the reader acts at, from the server's own staffing records. */
  private async attributionOf(user: AuthenticatedUser): Promise<AuditAttribution> {
    const tenant = await runAsSystem(() => this.tenants.resolve(user));
    return {
      hospitalId: tenant?.scope === 'hospital' ? (tenant.hospitalId ?? null) : null,
      sessionId: user.sessionId,
    };
  }

  private async recordRead(
    request: Request,
    user: AuthenticatedUser,
    spec: PhiReadSpec,
    attribution: AuditAttribution,
  ): Promise<void> {
    const params = (request.params ?? {}) as Record<string, string | undefined>;
    const resource = Object.values(params).find((value) => value !== undefined) ?? 'list';
    await this.disclosures.record({
      action: 'phi.read',
      actor: { userId: user.id, role: user.role, sessionId: user.sessionId },
      entityType: spec.resource,
      entityId: resource,
      hospitalId: attribution.hospitalId,
      metadata: {
        route: (request.route as { path?: string } | undefined)?.path ?? request.path,
        method: request.method,
      },
    });
  }
}
