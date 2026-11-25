import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { zodBody } from '../../../common/validation/zod-validation.pipe';
import { Can, NotPhi } from '../../../shared/authz';
import type { AiMessageView, AiModelView, AiPromptView, AiSettingsView } from '../dto/ai.dto';
import {
  messageFeedbackSchema,
  updateAiSettingsSchema,
  type MessageFeedbackInput,
  type UpdateAiSettingsInput,
} from '../dto/ai.schema';
import { AiSettingsService } from '../services/ai-settings.service';

/**
 * Prompts, feedback and the model card — API §11.5, §11.7 (RM M16.5).
 *
 * Split from `AiSettingsUserController` below because Nest binds one
 * path prefix per class and these sit under `/ai` while the settings
 * document sits under `/me`. The service is shared, so the two cannot
 * drift.
 */
@Can('ai.use')
@Controller('ai')
export class AiPromptController {
  constructor(private readonly settings: AiSettingsService) {}

  /** API §11.5 — the library, marked with the caller's favourites. */
  @NotPhi('AI configuration; no patient data')
  @Get('prompts')
  prompts(@CurrentUser() user: AuthenticatedUser): Promise<readonly AiPromptView[]> {
    return this.settings.prompts(user);
  }

  /**
   * API §11 — what the deployment is actually running.
   *
   * Served rather than hard-coded in the client because the frontend's
   * `AI_MODEL_NAME` is `'Medora Clinical Assistant (mock)'` — a constant
   * that says "mock" whatever the deployment is doing. `configured`
   * is the honest bit: false until a provider is wired, matching what
   * `/health` already reports (ADR-016).
   */
  @NotPhi('AI configuration; no patient data')
  @Get('model')
  model(): AiModelView {
    return this.settings.model();
  }

  /** API §11.7 — the thumbs on one assistant turn. */
  @Post('messages/:messageId/feedback')
  @HttpCode(HttpStatus.OK)
  rate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('messageId') messageId: string,
    @Body(zodBody(messageFeedbackSchema)) body: MessageFeedbackInput,
  ): Promise<AiMessageView> {
    return this.settings.rate(user, messageId, body);
  }
}

/**
 * The caller's own assistant settings — API §11.6.
 *
 * Under `/me`, alongside `/me/settings` and `/me/profile`, because it is
 * a slice of the caller's own preferences rather than a property of the
 * assistant. `GET` answers the documented defaults for a user who has
 * never saved any, rather than 404: a settings drawer opening on a 404
 * would have nothing to render, and `DEFAULT_AI_SETTINGS` already says
 * what an unsaved user has.
 */
@Can('ai.use')
@Controller('me/ai-settings')
export class AiUserSettingsController {
  constructor(private readonly settings: AiSettingsService) {}

  @NotPhi('AI configuration; no patient data')

  @Get()
  read(@CurrentUser() user: AuthenticatedUser): Promise<AiSettingsView> {
    return this.settings.read(user);
  }

  /** PUT, not PATCH: the contract's, and the drawer sends the whole document. */
  @Put()
  save(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(updateAiSettingsSchema)) body: UpdateAiSettingsInput,
  ): Promise<AiSettingsView> {
    return this.settings.save(user, body);
  }
}
