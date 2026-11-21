import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { AppException } from '../errors/app.exception';
import { defaultCodeForStatus, type ErrorCode } from '../errors/error-codes';
import { CORRELATION_ID_HEADER, getCorrelationId } from '../logging/correlation';
import { describeError } from '../logging/error-description';
import { loggableUrl } from '../logging/redaction';

/**
 * The error envelope (API §0.3, MG §10.4).
 *
 * ```json
 * { "message": "…", "code": "…", "fieldErrors": {…}, "detail": "…", "ref": "…" }
 * ```
 *
 * The status → client-kind mapping is implemented verbatim in the
 * frontend's `api/errors.ts`, so this filter is the server half of a
 * contract that already exists in code:
 *
 * | status  | client kind    | this filter guarantees        |
 * |---------|----------------|-------------------------------|
 * | 400/422 | validation     | `fieldErrors` present         |
 * | 401     | auth           | `code` present (ADR-012)      |
 * | 403     | forbidden      | —                             |
 * | 404     | not_found      | —                             |
 * | 409     | conflict       | `detail` present              |
 * | 429     | rate_limited   | `Retry-After` header          |
 * | 5xx     | server         | `ref` present, no leakage     |
 *
 * Every response carries `code` — ADR-012 exists because the frontend
 * cannot distinguish a wrong password from an expired session without it.
 */
export interface ErrorEnvelope {
  readonly message: string;
  readonly code: ErrorCode;
  readonly fieldErrors?: Readonly<Record<string, readonly string[]>>;
  readonly detail?: string;
  readonly ref?: string;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();
    const correlationId = getCorrelationId(request);

    const status = resolveStatus(exception);
    const body = this.buildBody(exception, status, correlationId);

    if (exception instanceof AppException && exception.retryAfterSeconds !== undefined) {
      response.setHeader('Retry-After', String(exception.retryAfterSeconds));
    } else if (status === HttpStatus.TOO_MANY_REQUESTS) {
      // The contract requires the header on every 429 (API §0.3); a
      // rate limiter that omits it leaves the client guessing.
      response.setHeader('Retry-After', '60');
    }

    response.setHeader(CORRELATION_ID_HEADER, correlationId);

    // 5xx is the only class where the cause is ours to investigate, so
    // it is the only class we log at error level with a stack.
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        {
          err: describeError(exception),
          correlationId,
          // The path only: a query string can carry a patient's name.
          path: loggableUrl(request.url),
          method: request.method,
        },
        'Unhandled exception',
      );
    }

    response.status(status).json(body);
  }

  private buildBody(exception: unknown, status: HttpStatus, correlationId: string): ErrorEnvelope {
    if (exception instanceof AppException) {
      return stripUndefined({
        message: exception.message,
        code: exception.code,
        fieldErrors: exception.fieldErrors,
        detail: exception.detail,
        ref: status >= HttpStatus.INTERNAL_SERVER_ERROR ? correlationId : undefined,
      });
    }

    if (exception instanceof HttpException) {
      return stripUndefined({
        message: httpExceptionMessage(exception),
        code: defaultCodeForStatus(status),
        detail: status === HttpStatus.CONFLICT ? httpExceptionMessage(exception) : undefined,
        ref: status >= HttpStatus.INTERNAL_SERVER_ERROR ? correlationId : undefined,
      });
    }

    // A body-parser client error (see `clientHttpErrorStatus`). Its
    // message is the library's fixed text — "request entity too large" —
    // never request content, so it is safe to return.
    if (clientHttpErrorStatus(exception) !== undefined) {
      return {
        message: (exception as Error).message,
        code: defaultCodeForStatus(status),
      };
    }

    // Unknown throwable. The message is deliberately generic: an ORM or
    // driver error can carry row contents, and PHI must never reach a
    // response body (MG §11.6). `ref` ties it to the logged detail.
    return {
      message: 'Internal server error',
      code: 'internal_error',
      ref: correlationId,
    };
  }
}

/**
 * Returned as `HttpStatus` rather than `number` so every comparison in
 * this file is enum-to-enum. `getStatus()` is typed `number`, so the
 * narrowing happens once, here, instead of at each call site.
 */
function resolveStatus(exception: unknown): HttpStatus {
  if (exception instanceof HttpException) {
    return exception.getStatus();
  }
  return clientHttpErrorStatus(exception) ?? HttpStatus.INTERNAL_SERVER_ERROR;
}

/**
 * The status of an `http-errors` client error, or `undefined`.
 *
 * Express's body parser rejects a request before any route runs, and Nest
 * converts only one of its failures — malformed JSON — into a
 * `BadRequestException`. The rest arrive here as plain errors carrying
 * their own status: an oversized body (413 `entity.too.large`), an
 * unsupported charset or encoding (415). Treated as unknown throwables
 * they became a **500** and an error-level "unhandled exception" log
 * line for what is the client's mistake (AST-G2, RM M37.1).
 *
 * Recognised by shape, not by importing `http-errors`: `expose` is the
 * library's own statement that the message is safe to show the client,
 * and it is set only below 500. Anything else — a 5xx, or an error that
 * merely happens to have a `status` field — stays an unknown throwable.
 */
function clientHttpErrorStatus(exception: unknown): HttpStatus | undefined {
  if (!(exception instanceof Error)) return undefined;
  const { status, expose } = exception as { status?: unknown; expose?: unknown };
  if (expose !== true || typeof status !== 'number') return undefined;
  if (status < 400 || status >= 500) return undefined;
  return status;
}

/**
 * Nest's built-in exceptions carry either a string or a `{ message }`
 * object. Validation errors arrive as arrays; those are joined so the
 * envelope's `message` is always a single human-readable string.
 */
function httpExceptionMessage(exception: HttpException): string {
  const payload: unknown = exception.getResponse();

  if (typeof payload === 'string') return payload;

  if (typeof payload === 'object' && payload !== null && 'message' in payload) {
    const { message } = payload;
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return message.map((entry) => String(entry)).join('; ');
  }

  return exception.message;
}

/** Omits absent optional keys so the envelope has no `"detail": null` noise. */
function stripUndefined(envelope: {
  message: string;
  code: ErrorCode;
  fieldErrors?: Readonly<Record<string, readonly string[]>> | undefined;
  detail?: string | undefined;
  ref?: string | undefined;
}): ErrorEnvelope {
  const { message, code } = envelope;
  return {
    message,
    code,
    ...(envelope.fieldErrors !== undefined ? { fieldErrors: envelope.fieldErrors } : {}),
    ...(envelope.detail !== undefined ? { detail: envelope.detail } : {}),
    ...(envelope.ref !== undefined ? { ref: envelope.ref } : {}),
  };
}
