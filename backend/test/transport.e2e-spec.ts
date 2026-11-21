import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  type INestApplication,
  Module,
  NotFoundException,
  Post,
} from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { AppException } from '../src/common/errors/app.exception';
import { AllExceptionsFilter } from '../src/common/http/all-exceptions.filter';
import { ResponseInterceptor } from '../src/common/http/response.interceptor';
import { CORRELATION_ID_HEADER } from '../src/common/logging/correlation';
import { CorrelationMiddleware } from '../src/common/logging/correlation.middleware';
import { zodBody } from '../src/common/validation/zod-validation.pipe';

/**
 * Transport conformance (RM M1.2, M1.3, M1.5).
 *
 * These assertions are the server half of `frontend/src/api/errors.ts`.
 * That file maps each status onto an `ApiError` kind and reads specific
 * fields off the body; if any assertion here changes, a frontend error
 * state breaks. The mapping is contract (API §0.3), not preference.
 */

const demoSchema = z.object({
  email: z.string().email(),
  age: z.number().int().min(0),
  contact: z.object({ phone: z.string().min(7) }),
});

@Controller('demo')
class DemoController {
  @Get('ok')
  ok(): { value: number } {
    return { value: 42 };
  }

  @Get('list')
  list(): { items: string[]; page: number } {
    return { items: ['a'], page: 1 };
  }

  @Get('no-content')
  @HttpCode(HttpStatus.NO_CONTENT)
  noContent(): undefined {
    return undefined;
  }

  @Get('validation')
  validation(): never {
    throw AppException.validation({ email: ['Invalid email'] });
  }

  @Get('unauthorized')
  unauthorized(): never {
    throw AppException.unauthorized('invalid_credentials', 'Invalid email or password');
  }

  @Get('forbidden')
  forbidden(): never {
    throw AppException.forbidden();
  }

  @Get('not-found')
  notFound(): never {
    throw new NotFoundException('Nothing here');
  }

  @Get('conflict')
  conflict(): never {
    throw AppException.conflict('Appointment is already confirmed', 'conflict');
  }

  @Get('rate-limited')
  rateLimited(): never {
    throw AppException.rateLimited(30);
  }

  @Get('boom')
  boom(): never {
    // A raw throwable carrying something PHI-shaped, to prove the filter
    // never echoes an unknown error's message back to the client.
    throw new Error('patient Amira Saleh MRN 4468-12 failed constraint');
  }

  @Post('validated')
  validated(@Body(zodBody(demoSchema)) body: z.infer<typeof demoSchema>): { email: string } {
    return { email: body.email };
  }
}

@Module({
  controllers: [DemoController],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
class DemoModule {
  configure(consumer: { apply: (m: unknown) => { forRoutes: (r: string) => void } }): void {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}

/** The error envelope, as the frontend's `normalizeHttpError` reads it. */
interface ErrorBody {
  message: string;
  code: string;
  detail?: string;
  fieldErrors?: Record<string, string[]>;
  ref?: string;
}

describe('transport contract', () => {
  let app: INestApplication;

  /** `getHttpServer()` is typed `any`; narrow it once, here. */
  const server = (): Server => app.getHttpServer() as Server;
  const errorBody = (response: { body: unknown }): ErrorBody => response.body as ErrorBody;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [DemoModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(new CorrelationMiddleware().use.bind(new CorrelationMiddleware()));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('success envelope (API §0.2)', () => {
    it('wraps a payload in { data }', async () => {
      const response = await request(server()).get('/demo/ok').expect(200);
      expect(response.body as unknown).toEqual({ data: { value: 42 } });
    });

    it('wraps a paginated payload without flattening it', async () => {
      const response = await request(server()).get('/demo/list').expect(200);
      expect(response.body as unknown).toEqual({ data: { items: ['a'], page: 1 } });
    });

    it('sends no body for a 204 — the client returns undefined without parsing', async () => {
      const response = await request(server()).get('/demo/no-content').expect(204);
      expect(response.text).toBe('');
    });
  });

  describe('error envelope (API §0.3)', () => {
    it('422 carries fieldErrors — the client maps this to kind: validation', async () => {
      const response = await request(server()).get('/demo/validation').expect(422);
      expect(response.body as unknown).toMatchObject({
        code: 'validation_failed',
        fieldErrors: { email: ['Invalid email'] },
      });
      expect(typeof errorBody(response).message).toBe('string');
    });

    it('401 carries the machine code the auth pages branch on (ADR-012)', async () => {
      const response = await request(server()).get('/demo/unauthorized').expect(401);
      // Without this the frontend cannot tell a wrong password from an
      // expired session, and treats both as a logout.
      expect(errorBody(response).code).toBe('invalid_credentials');
    });

    it('403 maps to forbidden', async () => {
      const response = await request(server()).get('/demo/forbidden').expect(403);
      expect(errorBody(response).code).toBe('forbidden');
    });

    it('404 maps to not_found', async () => {
      const response = await request(server()).get('/demo/not-found').expect(404);
      expect(errorBody(response).code).toBe('not_found');
    });

    it('409 carries detail — the client renders it in the merge dialog', async () => {
      const response = await request(server()).get('/demo/conflict').expect(409);
      expect(response.body as unknown).toMatchObject({
        code: 'conflict',
        detail: 'Appointment is already confirmed',
      });
    });

    it('429 sets Retry-After in seconds', async () => {
      const response = await request(server()).get('/demo/rate-limited').expect(429);
      expect(response.headers['retry-after']).toBe('30');
      expect(errorBody(response).code).toBe('rate_limited');
    });

    it('500 carries ref and never echoes the thrown message', async () => {
      const response = await request(server()).get('/demo/boom').expect(500);
      expect(errorBody(response).message).toBe('Internal server error');
      expect(errorBody(response).code).toBe('internal_error');
      expect(typeof errorBody(response).ref).toBe('string');
      // PHI leakage guard (MG §11.6).
      expect(JSON.stringify(errorBody(response))).not.toContain('Amira');
      expect(JSON.stringify(errorBody(response))).not.toContain('4468-12');
    });

    it('omits absent optional keys rather than sending nulls', async () => {
      const response = await request(server()).get('/demo/forbidden').expect(403);
      expect(response.body as unknown).not.toHaveProperty('detail');
      expect(response.body as unknown).not.toHaveProperty('fieldErrors');
      expect(response.body as unknown).not.toHaveProperty('ref');
    });
  });

  describe('Zod validation (RM M1.5)', () => {
    it('returns 422 with fieldErrors keyed by field path', async () => {
      const response = await request(server())
        .post('/demo/validated')
        .send({ email: 'nope', age: -1, contact: { phone: '12' } })
        .expect(422);

      const fieldErrors = errorBody(response).fieldErrors ?? {};

      // The exact key set, not a subset: an extra key would mean a field
      // path the frontend has no input for, and RHF would drop the error.
      // `contact.phone` is dotted because that is how RHF addresses it.
      expect(Object.keys(fieldErrors).sort()).toEqual(['age', 'contact.phone', 'email']);
      expect(fieldErrors['contact.phone']?.length).toBeGreaterThan(0);
    });

    it('passes a valid body through', async () => {
      const response = await request(server())
        .post('/demo/validated')
        .send({ email: 'doctor@medora.health', age: 40, contact: { phone: '1234567' } })
        .expect(201);

      expect(response.body as unknown).toEqual({ data: { email: 'doctor@medora.health' } });
    });
  });

  describe('correlation id (RM M1.3)', () => {
    it('echoes the id the client sent', async () => {
      const sent = 'corr-abc-123';
      const response = await request(server())
        .get('/demo/ok')
        .set(CORRELATION_ID_HEADER, sent)
        .expect(200);

      expect(response.headers[CORRELATION_ID_HEADER]).toBe(sent);
    });

    it('generates one when the client sends none', async () => {
      const response = await request(server()).get('/demo/ok').expect(200);
      expect(response.headers[CORRELATION_ID_HEADER]).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('uses the correlation id as the 5xx support ref', async () => {
      const sent = 'corr-trace-me';
      const response = await request(server())
        .get('/demo/boom')
        .set(CORRELATION_ID_HEADER, sent)
        .expect(500);

      expect(errorBody(response).ref).toBe(sent);
    });
  });
});
