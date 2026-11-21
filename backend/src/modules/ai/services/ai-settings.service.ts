/**
 * Settings, prompts and feedback (RM M16.5, M16.7 — API §11.5–§11.7).
 *
 * > ✅ Verify: settings round-trip; out-of-range temperature → 422.
 */

import { Inject, Injectable } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { AppException } from '../../../common/errors/app.exception';
import type { AiLanguage, AiResponseLength } from '../../../generated/prisma/client';
import { AI_GATEWAY, type AiGatewayPort } from '../../../shared/ai';
import {
  AI_LANGUAGE_FROM_WIRE,
  AI_RESPONSE_LENGTH_FROM_WIRE,
  aiContextModeToWire,
  aiLanguageToWire,
  aiResponseLengthToWire,
} from '../dto/ai-enums';
import type { AiMessageView, AiModelView, AiPromptView, AiSettingsView } from '../dto/ai.dto';
import type { MessageFeedbackInput, UpdateAiSettingsInput } from '../dto/ai.schema';
import { AiConversationRepository } from '../repositories/ai-conversation.repository';
import { AiSettingsRepository, type SettingsRow } from '../repositories/ai-settings.repository';
import { toMessageView } from './ai-projection';

/**
 * `DEFAULT_AI_SETTINGS` from `features/doctor/ai/model/types.ts`,
 * verbatim and rank-1 — except for `favoritePromptIds`.
 *
 * The frontend's default is `['summarize-patient', 'drug-interactions']`,
 * which are **slugs**. `ai_user_settings.favorite_prompt_ids` is
 * `uuid[]` (DB §H3), so the same two defaults cannot be expressed as
 * literals here — the ids differ per deployment because they are
 * generated at seed time. They are resolved from the catalogue by slug
 * instead, which is what keeps the default the frontend's rather than an
 * empty list that merely looks safe.
 */
export const DEFAULT_SETTINGS = {
  temperature: 0.3,
  responseLength: 'balanced',
  language: 'en',
  autoContext: true,
  streaming: true,
} as const;

/** The two slugs `DEFAULT_AI_SETTINGS.favoritePromptIds` names. */
export const DEFAULT_FAVOURITE_SLUGS: readonly string[] = [
  'summarize-patient',
  'drug-interactions',
];

@Injectable()
export class AiSettingsService {
  constructor(
    private readonly settings: AiSettingsRepository,
    private readonly conversations: AiConversationRepository,
    @Inject(AI_GATEWAY) private readonly gateway: AiGatewayPort,
  ) {}

  /** API §11.6 — `GET /me/ai-settings`. */
  async read(user: AuthenticatedUser): Promise<AiSettingsView> {
    const row = await this.settings.find(user.id);

    return row === null ? await this.defaults() : toSettingsView(row);
  }

  /** API §11.6 — `PUT /me/ai-settings`. */
  async save(
    user: AuthenticatedUser,
    input: UpdateAiSettingsInput,
  ): Promise<AiSettingsView> {
    // A favourite naming a template that does not exist would come back
    // on every `GET /ai/prompts` as a favourite with nothing to mark,
    // and would survive an administrator retiring the template. Refused
    // rather than silently dropped: a client whose list was quietly
    // trimmed would show the star it just set disappearing.
    const known = await this.settings.existingPromptIds(input.favoritePromptIds);
    const unknown = input.favoritePromptIds.filter((id) => !known.includes(id));

    if (unknown.length > 0) {
      throw AppException.validation(
        { favoritePromptIds: [`Unknown prompt template: ${unknown.join(', ')}`] },
        'Unknown prompt template',
      );
    }

    const row = await this.settings.save(user.id, {
      temperature: input.temperature,
      responseLength: lengthToEnum(input.responseLength),
      language: languageToEnum(input.language),
      autoContext: input.autoContext,
      streaming: input.streaming,
      favoritePromptIds: input.favoritePromptIds,
    });

    return toSettingsView(row);
  }

  /**
   * The settings a generation runs under.
   *
   * Separate from `read` because it returns the raw values rather than
   * the view, and because an unsaved user must generate under the
   * documented defaults rather than under whatever a null row would
   * coerce to.
   */
  async effective(userId: string): Promise<{
    readonly temperature: number;
    readonly responseLength: string;
    readonly language: string;
  }> {
    const row = await this.settings.find(userId);

    if (row === null) {
      return {
        temperature: DEFAULT_SETTINGS.temperature,
        responseLength: DEFAULT_SETTINGS.responseLength,
        language: DEFAULT_SETTINGS.language,
      };
    }

    return {
      temperature: row.temperature.toNumber(),
      responseLength: aiResponseLengthToWire(row.responseLength),
      language: aiLanguageToWire(row.language),
    };
  }

  /** API §11.5 — `GET /ai/prompts`, marked with the caller's favourites. */
  async prompts(user: AuthenticatedUser): Promise<readonly AiPromptView[]> {
    const [templates, saved] = await Promise.all([
      this.settings.prompts(),
      this.settings.find(user.id),
    ]);

    const favourites = new Set(
      saved === null
        ? templates
            .filter((template) => DEFAULT_FAVOURITE_SLUGS.includes(template.slug))
            .map((template) => template.id)
        : saved.favoritePromptIds,
    );

    return templates.map((template) => ({
      id: template.id,
      title: template.label,
      description: template.description,
      message: template.promptText,
      // "Ranking only, never a gate" — the frontend's own words, and the
      // reason this is nullable rather than defaulted to `general`.
      affinity: template.contextMode === null ? null : aiContextModeToWire(template.contextMode),
      favorite: favourites.has(template.id),
    }));
  }

  /** API §11.7 — `POST /ai/messages/{id}/feedback`. */
  async rate(
    user: AuthenticatedUser,
    messageId: string,
    input: MessageFeedbackInput,
  ): Promise<AiMessageView> {
    // `-1` / `+1`, which is what DB §H2's `feedback` smallint holds and
    // what its comment calls the thumbs.
    const row = await this.conversations.rateMessage(
      user.id,
      messageId,
      input.rating === 'up' ? 1 : -1,
    );

    if (row === null) {
      // Covers three cases with one answer, deliberately: the message
      // does not exist, it belongs to someone else's thread, or it is
      // the doctor's own question rather than an answer. Distinguishing
      // them would confirm which messages exist.
      throw AppException.notFound('Message not found');
    }

    return toMessageView(row);
  }

  /** API §11's status card — what the deployment is actually running. */
  model(): AiModelView {
    return this.gateway.describe();
  }

  /** The frontend's defaults, with the two favourites resolved by slug. */
  private async defaults(): Promise<AiSettingsView> {
    const templates = await this.settings.prompts();

    return {
      ...DEFAULT_SETTINGS,
      favoritePromptIds: templates
        .filter((template) => DEFAULT_FAVOURITE_SLUGS.includes(template.slug))
        .map((template) => template.id),
    };
  }
}

function toSettingsView(row: SettingsRow): AiSettingsView {
  return {
    // `Decimal(2,1)` — `toNumber` rather than `Number(row.temperature)`,
    // which would stringify through the Decimal's own `toString`.
    temperature: row.temperature.toNumber(),
    responseLength: aiResponseLengthToWire(row.responseLength),
    language: aiLanguageToWire(row.language),
    autoContext: row.autoContext,
    streaming: row.streaming,
    favoritePromptIds: row.favoritePromptIds,
  };
}

function lengthToEnum(wire: string): AiResponseLength {
  return AI_RESPONSE_LENGTH_FROM_WIRE[wire] ?? 'BALANCED';
}

function languageToEnum(wire: string): AiLanguage {
  return AI_LANGUAGE_FROM_WIRE[wire] ?? 'EN';
}
