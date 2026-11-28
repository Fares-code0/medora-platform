import { createHash } from 'node:crypto';

import {
  type CallHandler,
  type ExecutionContext,
  HttpStatus,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { catchError, concatMap, from, type Observable, of, throwError } from 'rxjs';

import { AUTHENTICATED_USER, type RequestWithUser } from '../../common/auth/authenticated-user';
import { AppException } from '../../common/errors/app.exception';

import { IDEMPOTENT, type IdempotentMetadata } from './idempotent.decorator';
import { IdempotencyStore } from './idempotency.store';

export const IDEMPOTENCY_HEADER = 'idempotency-key';
export const REPLAYED_HEADER = 'Idempotency-Replayed';

/**
 * Visible ASCII, 1–128 characters. A UUID — what every client generates —
 * fits with room to spare; the bound is the column's.
 */
const KEY_SHAPE = /^[\x21-\x7E]{1,128}$/;

/**
 * `Idempotency-Key` on the routes marked `@Idempotent()` (ADR-014, API
 * §0.5: "State-changing POSTs accept `Idempotency-Key`; replays return the
 * original result").
 *
 * ## The four answers
 *
 * - **No header** — the default path, unchanged (ADR-014 §3). A client
 *   that sends nothing behaves exactly as it did — except on a route
 *   marked `@Idempotent({ required: true })`, which answers 422.
 * - **A new key** — the request executes; its result is stored against
 *   `(user, key)` for 24 h. A failure of the handler releases the key,
 *   so a retry after a 4xx or 5xx executes again rather than replaying
 *   the failure. A failure to store the result *after* the handler
 *   succeeded does not (APT-02): the key stays in progress.
 * - **A key seen before, same request** — the stored result is returned
 *   and the handler **does not run**: no second appointment, no second
 *   signed prescription, no second message. `Idempotency-Replayed: true`
 *   marks it.
 * - **A key seen before, different request** — `422
 *   idempotency_key_reused`; a key still executing — `409
 *   idempotency_request_in_progress`. The status choices are the IETF
 *   `Idempotency-Key` draft's.
 *
 * "Same request" means the same `METHOD /path` — ids included, so a key
 * reused on another prescription's `/sign` is a different request — and
 * the same body, compared by SHA-256 of its canonical JSON.
 *
 * ## Scoped per user, and only after authentication
 *
 * The record is keyed on the authenticated principal, so one account's
 * key can never return another's result (ADR-014 §1). Interceptors run
 * after guards, so an unauthenticated or unauthorised request never
 * reaches the store: a 401 or 403 is not something to replay.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly store: IdempotencyStore,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const marked = this.reflector.getAllAndOverride<IdempotentMetadata | undefined>(IDEMPOTENT, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (marked === undefined) return next.handle();
    const required = marked !== true && marked.required === true;

    const http = context.switchToHttp();
    const request = http.getRequest<Request & RequestWithUser>();
    const raw = request.headers[IDEMPOTENCY_HEADER];
    if (raw === undefined) {
      if (!required) return next.handle();
      return throwError(() =>
        AppException.validation(
          { 'Idempotency-Key': ['This request requires an Idempotency-Key header'] },
          'The Idempotency-Key header is required',
        ),
      );
    }

    const key = Array.isArray(raw) ? raw[0] : raw;
    if (key === undefined || !KEY_SHAPE.test(key) || Array.isArray(raw)) {
      return throwError(() =>
        AppException.validation(
          { 'Idempotency-Key': ['Send one key of 1–128 visible ASCII characters'] },
          'The Idempotency-Key header is malformed',
        ),
      );
    }

    const user = request[AUTHENTICATED_USER];
    // A marked route is always authenticated; without a principal there is
    // no one to scope the key to, so the header is ignored rather than
    // shared across callers.
    if (user === undefined) return next.handle();

    const response = http.getResponse<Response>();

    return from(
      this.store.claim({
        userId: user.id,
        key,
        endpoint: `${request.method} ${request.path}`.slice(0, 300),
        fingerprint: fingerprintOf(request.body),
      }),
    ).pipe(
      concatMap((claim) => {
        switch (claim.kind) {
          case 'replay':
            response.setHeader(REPLAYED_HEADER, 'true');
            return of(claim.body ?? undefined);

          case 'mismatch':
            return throwError(
              () =>
                new AppException(HttpStatus.UNPROCESSABLE_ENTITY, {
                  code: 'idempotency_key_reused',
                  message: 'This Idempotency-Key was already used for a different request',
                  fieldErrors: {
                    'Idempotency-Key': ['Use a new key for a new request'],
                  },
                }),
            );

          case 'in_progress':
            return throwError(() =>
              AppException.conflict(
                'A request with this Idempotency-Key is still being processed; retry shortly',
                'idempotency_request_in_progress',
              ),
            );

          case 'claimed':
            // APT-02: only a failure of the *handler* releases the key. The
            // completion write runs after the handler's business commit, so
            // a failure there must not release the key — the retry would
            // execute the write a second time. It is retried once; if it
            // still fails the key stays `in_progress` (a retry is told 409
            // `idempotency_request_in_progress`, never re-executed) and the
            // committed result is returned.
            return next.handle().pipe(
              catchError((error: unknown) =>
                from(this.store.release(claim.id)).pipe(concatMap(() => throwError(() => error))),
              ),
              concatMap((body: unknown) =>
                from(this.completeAfterCommit(claim.id, body)).pipe(concatMap(() => of(body))),
              ),
            );
        }
      }),
    );
  }

  private async completeAfterCommit(id: string, body: unknown): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await this.store.complete(id, body);
        return;
      } catch (error) {
        if (attempt === 1) {
          this.logger.error(
            `Idempotency completion failed after the request committed; the key stays in progress (${
              error instanceof Error ? error.name : 'unknown error'
            })`,
          );
        }
      }
    }
  }
}

/**
 * SHA-256 of the body as canonical JSON — keys sorted at every depth, so
 * a client that serialises the same object in another key order is still
 * sending the same request.
 */
export function fingerprintOf(body: unknown): string {
  return createHash('sha256')
    .update(canonical(body ?? null))
    .digest('hex');
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;

  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

    return `{${entries.map(([name, item]) => `${JSON.stringify(name)}:${canonical(item)}`).join(',')}}`;
  }

  return JSON.stringify(value) ?? 'null';
}
