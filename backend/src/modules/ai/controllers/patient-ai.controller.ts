import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { AppException } from '../../../common/errors/app.exception';
import { zodBody } from '../../../common/validation/zod-validation.pipe';
import { Authenticated, NotPhi } from '../../../shared/authz';
import { RateLimited } from '../../../shared/rate-limit';
import type {
  PatientAiConversationCreated,
  PatientAiConversationDetailView,
  PatientAiConversationView,
} from '../dto/patient-ai.dto';
import {
  createPatientConversationSchema,
  sendPatientMessageSchema,
  type CreatePatientConversationInput,
  type SendPatientMessageInput,
} from '../dto/patient-ai.schema';
import { PatientAiService, type PatientAiStreamEvent } from '../services/patient-ai.service';

/**
 * The patient assistant — `/me/ai/conversations` (ADR-050, contract §6).
 *
 * A separate controller from the clinician assistant's `/ai/conversations`,
 * with its own service, prompts and repository. `@Authenticated()` rather
 * than a capability (a patient holds none, ADR-030 §6); the service refuses
 * every non-patient with 403 `patient_only` before touching a row.
 *
 * The send route streams Server-Sent Events exactly as the clinician route
 * does (`@Res()`, the first pull before any header so a refusal is a real
 * 404/409/503): `event: delta` frames `{ text }`, then one `event: done`
 * frame `{ messageId, status, error, escalated }`.
 */
@Authenticated()
@Controller('me/ai/conversations')
export class PatientAiController {
  constructor(private readonly assistant: PatientAiService) {}

  @NotPhi('the patient’s own assistant threads (self access)')
  @Get()
  list(@CurrentUser() user: AuthenticatedUser): Promise<readonly PatientAiConversationView[]> {
    return this.assistant.list(user);
  }

  @NotPhi('the patient’s own assistant thread (self access)')
  @Get(':conversationId')
  detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId') conversationId: string,
  ): Promise<PatientAiConversationDetailView> {
    return this.assistant.detail(user, conversationId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(createPatientConversationSchema)) body: CreatePatientConversationInput,
  ): Promise<PatientAiConversationCreated> {
    return this.assistant.create(user, body);
  }

  @Delete(':conversationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId') conversationId: string,
  ): Promise<void> {
    return this.assistant.remove(user, conversationId);
  }

  @RateLimited('patient_ai')
  @Post(':conversationId/messages')
  async send(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId') conversationId: string,
    @Body(zodBody(sendPatientMessageSchema)) body: SendPatientMessageInput,
    @Res() response: Response,
  ): Promise<void> {
    const controller = new AbortController();

    // `response`, not `request` — see `AiMessageController.send`.
    let completed = false;
    response.on('close', () => {
      if (!completed) controller.abort();
    });

    const stream = this.assistant.send(user, conversationId, body, controller.signal);

    let first: IteratorResult<PatientAiStreamEvent>;
    try {
      first = await stream.next();
    } catch (cause) {
      throw cause instanceof AppException
        ? cause
        : AppException.conflict('The assistant could not start', 'context_unresolved');
    }

    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    try {
      for (let step = first; step.done !== true; step = await stream.next()) {
        const { type, ...payload } = step.value;
        response.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);
      }
      completed = true;
    } finally {
      await stream.return(undefined as never).catch(() => undefined);
      response.end();
    }
  }
}
