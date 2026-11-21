import { randomUUID } from 'node:crypto';

import type { Request } from 'express';

/**
 * Correlation id — accepted, generated, echoed (API §0.1, MG §10.5).
 *
 * The frontend's `ApiClient` sends `X-Correlation-Id: <uuid>` on every
 * request (`client.ts`). We echo it back, bind it to every log line, and
 * return it as `ref` on 5xx so a user-reported support reference maps to
 * a specific request in the logs.
 */
export const CORRELATION_ID_HEADER = 'x-correlation-id';

/** Where the resolved id is stashed on the request object. */
const CORRELATION_ID_PROPERTY = 'correlationId';

interface CorrelatedRequest extends Request {
  [CORRELATION_ID_PROPERTY]?: string;
}

/**
 * Reads the inbound header, falling back to a generated uuid.
 *
 * A client-supplied value is untrusted input that ends up in log lines,
 * so it is length-capped and stripped of anything outside a conservative
 * character set — a newline here would let a caller forge log entries.
 */
export function resolveCorrelationId(request: Request): string {
  const header = request.headers[CORRELATION_ID_HEADER];
  const candidate = Array.isArray(header) ? header[0] : header;

  if (typeof candidate === 'string') {
    const sanitized = candidate.replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 128);
    if (sanitized.length > 0) return sanitized;
  }

  return randomUUID();
}

/** Returns the id assigned by the middleware, generating one if absent. */
export function getCorrelationId(request: Request): string {
  const correlated = request as CorrelatedRequest;
  correlated[CORRELATION_ID_PROPERTY] ??= resolveCorrelationId(request);
  return correlated[CORRELATION_ID_PROPERTY];
}

/** Assigns the id to the request. Called once, by the middleware. */
export function setCorrelationId(request: Request, id: string): void {
  (request as CorrelatedRequest)[CORRELATION_ID_PROPERTY] = id;
}
