import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Response } from 'express';
import { map, type Observable } from 'rxjs';

/**
 * Success envelope — `{ data: <payload> }` (API §0.2).
 *
 * The frontend's `ApiClient` unwraps exactly this shape, so every
 * successful body is wrapped here rather than in each controller. Two
 * cases pass through untouched:
 *
 *  - **204 No Content.** The client returns `undefined` without parsing
 *    a body (`client.ts`), so emitting `{ data: null }` would be a body
 *    on a bodyless response.
 *  - **Streams.** SSE (M16's AI streaming) and file downloads write to
 *    the response themselves; wrapping would corrupt the stream.
 */
export interface SuccessEnvelope<T> {
  readonly data: T;
}

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, SuccessEnvelope<T> | T> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<SuccessEnvelope<T> | T> {
    const response = context.switchToHttp().getResponse<Response>();

    return next.handle().pipe(
      map((payload): SuccessEnvelope<T> | T => {
        if (response.statusCode === 204 || payload === undefined) {
          return payload;
        }

        // Already-enveloped payloads are passed through so a handler that
        // needs full control (or a nested call) cannot be double-wrapped.
        if (isEnveloped(payload)) {
          return payload;
        }

        return { data: payload };
      }),
    );
  }
}

function isEnveloped(payload: unknown): boolean {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    !Array.isArray(payload) &&
    Object.keys(payload).length === 1 &&
    'data' in payload
  );
}
