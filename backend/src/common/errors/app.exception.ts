import { HttpException, HttpStatus } from '@nestjs/common';

import type { ErrorCode } from './error-codes';

/**
 * The error every domain module throws.
 *
 * `HttpException` alone cannot carry the fields the error envelope
 * requires (API §0.3): a machine `code`, a `detail` string on conflicts,
 * and `fieldErrors` on validation failures. `AppException` carries them
 * so the exception filter never has to guess.
 *
 * Prefer the named constructors below over `new AppException(...)` — they
 * encode the status/code pairings the contract fixes.
 */
export interface AppExceptionOptions {
  /** Human-readable, may be localised or reworded freely. */
  readonly message: string;
  /** Stable machine identifier the client branches on. */
  readonly code: ErrorCode;
  /** Required on 409 (API §0.3) — what conflicted, in human terms. */
  readonly detail?: string;
  /** Required on 400/422 — keyed by field path, values are messages. */
  readonly fieldErrors?: Readonly<Record<string, readonly string[]>>;
  /** Seconds, emitted as the `Retry-After` header on 429. */
  readonly retryAfterSeconds?: number;
}

export class AppException extends HttpException {
  readonly code: ErrorCode;
  readonly detail: string | undefined;
  readonly fieldErrors: Readonly<Record<string, readonly string[]>> | undefined;
  readonly retryAfterSeconds: number | undefined;

  constructor(status: HttpStatus, options: AppExceptionOptions) {
    super(options.message, status);
    this.code = options.code;
    this.detail = options.detail;
    this.fieldErrors = options.fieldErrors;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }

  /** 422 — the client maps this to `kind: 'validation'` and sets field errors. */
  static validation(
    fieldErrors: Readonly<Record<string, readonly string[]>>,
    message = 'Validation failed',
    code: ErrorCode = 'validation_failed',
  ): AppException {
    return new AppException(HttpStatus.UNPROCESSABLE_ENTITY, { message, code, fieldErrors });
  }

  /**
   * 401 — reserved for authentication failures and token problems only
   * (ADR-013). Authorization failures are 403; a stale document is 409.
   */
  static unauthorized(code: ErrorCode = 'unauthorized', message = 'Unauthorized'): AppException {
    return new AppException(HttpStatus.UNAUTHORIZED, { message, code });
  }

  /** 403 — authenticated but not permitted. */
  static forbidden(message = 'Forbidden', code: ErrorCode = 'forbidden'): AppException {
    return new AppException(HttpStatus.FORBIDDEN, { message, code });
  }

  /** 404 — also used to avoid confirming existence of out-of-scope records. */
  static notFound(message = 'Not found', code: ErrorCode = 'not_found'): AppException {
    return new AppException(HttpStatus.NOT_FOUND, { message, code });
  }

  /** 409 — illegal state transition or lost race. `detail` is mandatory. */
  static conflict(
    detail: string,
    code: ErrorCode = 'conflict',
    message = 'Conflict',
  ): AppException {
    return new AppException(HttpStatus.CONFLICT, { message, code, detail });
  }

  /** 429 — always paired with `Retry-After` (API §0.3). */
  static rateLimited(retryAfterSeconds: number, message = 'Too many requests'): AppException {
    return new AppException(HttpStatus.TOO_MANY_REQUESTS, {
      message,
      code: 'rate_limited',
      retryAfterSeconds,
    });
  }
}
