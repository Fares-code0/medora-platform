import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { CORRELATION_ID_HEADER, resolveCorrelationId, setCorrelationId } from './correlation';

/**
 * Runs before everything else: resolves the correlation id and echoes it
 * on the response, so even a request that fails in a later middleware
 * still comes back with the id the client can quote (RM M1.3).
 */
@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    const correlationId = resolveCorrelationId(request);
    setCorrelationId(request, correlationId);
    response.setHeader(CORRELATION_ID_HEADER, correlationId);
    next();
  }
}
