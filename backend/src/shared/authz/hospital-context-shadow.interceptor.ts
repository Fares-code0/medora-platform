import {
  Injectable,
  Logger,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { catchError, concatMap, from, type Observable, of } from 'rxjs';

import { AUTHENTICATED_USER, type RequestWithUser } from '../../common/auth/authenticated-user';
import {
  HOSPITAL_CONTEXT,
  type RequestWithHospitalContext,
} from '../../common/auth/hospital-context';
import { HospitalContextService } from './hospital-context.service';

/**
 * Attaches a derived context after the existing global guards have run.
 * Resolution failures are recorded as unresolved and never change the
 * request result while Phase 22 is in shadow mode.
 */
@Injectable()
export class HospitalContextShadowInterceptor implements NestInterceptor {
  private readonly logger = new Logger(HospitalContextShadowInterceptor.name);

  constructor(private readonly contexts: HospitalContextService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context
      .switchToHttp()
      .getRequest<Request & RequestWithUser & RequestWithHospitalContext>();
    const user = request[AUTHENTICATED_USER];
    if (user === undefined) return next.handle();

    return from(this.contexts.resolve(user)).pipe(
      catchError(() => {
        this.logger.warn('Hospital context shadow resolution unavailable');
        return of({ kind: 'unresolved', reason: 'resolution_unavailable' } as const);
      }),
      concatMap((hospitalContext) => {
        request[HOSPITAL_CONTEXT] = hospitalContext;
        return next.handle();
      }),
    );
  }
}
