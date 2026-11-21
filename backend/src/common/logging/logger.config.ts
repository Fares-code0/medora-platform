import type { IncomingMessage, ServerResponse } from 'node:http';

import type { Params } from 'nestjs-pino';

import { getCorrelationId } from './correlation';
import { serializeLoggedError } from './error-description';
import { loggableUrl, REDACTION_CENSOR, REDACTION_PATHS } from './redaction';

/**
 * pino JSON logging bound to the correlation id (RM M1.3).
 *
 * Structured JSON in every environment except local development, where
 * `pino-pretty` makes it readable. The serialisers deliberately emit no
 * request or response body — see `redaction.ts` for why.
 *
 * Takes its inputs as arguments rather than reading `process.env`
 * (RM M3.1): `common/` sits below `config/` in the layering, so it
 * cannot import the validated environment, and reading the raw one here
 * would put a second, unvalidated source of configuration in the
 * codebase — the exact thing the env contract exists to prevent.
 */
export interface LoggerOptionsInput {
  readonly appEnv: string;
  /**
   * Already validated against pino's levels by the env schema. Absent
   * means "choose for me", which is what the fallback below does.
   */
  readonly logLevel?: string | undefined;
}

export function buildLoggerOptions({ appEnv, logLevel }: LoggerOptionsInput): Params {
  const isDevelopment = appEnv === 'development';

  return {
    pinoHttp: {
      level: logLevel ?? (isDevelopment ? 'debug' : 'info'),

      // Every line carries the id the client sent, so a support
      // reference resolves to one request across every service.
      genReqId: (request: IncomingMessage) =>
        getCorrelationId(request as Parameters<typeof getCorrelationId>[0]),

      redact: {
        paths: [...REDACTION_PATHS],
        censor: REDACTION_CENSOR,
      },

      serializers: {
        req: (request: IncomingMessage & { id?: string; url?: string; method?: string }) => ({
          id: request.id,
          method: request.method,
          // Query strings are dropped wholesale (`loggableUrl`).
          url: loggableUrl(request.url),
        }),
        res: (response: ServerResponse) => ({ statusCode: response.statusCode }),
        // Name, code, stack and (except for Prisma) message — never the
        // enumerable rest, which is where a driver error carries the row
        // it refused. See `error-description.ts`.
        err: serializeLoggedError,
      },

      // 4xx is the client's problem and is not an application warning;
      // 5xx is ours. Anything else is routine traffic.
      customLogLevel: (_request, response: ServerResponse, error?: Error) => {
        if (error !== undefined || response.statusCode >= 500) return 'error';
        if (response.statusCode >= 400) return 'info';
        return 'info';
      },

      ...(isDevelopment
        ? {
            transport: {
              target: 'pino-pretty',
              options: { singleLine: true, translateTime: 'HH:MM:ss.l' },
            },
          }
        : {}),
    },
  };
}
