/**
 * Per-user assistant settings and the prompt library (RM M16.5, DB §H3–H4).
 *
 * Two tables, one class, because they are read together: `GET
 * /ai/prompts` marks each template with whether it is in the caller's
 * `favoritePromptIds`, so serving the library without the settings row
 * would need a second round trip to answer a boolean.
 */

import { Injectable } from '@nestjs/common';

import type { AiLanguage, AiResponseLength, Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../shared/database';

const SETTINGS_SELECT = {
  temperature: true,
  responseLength: true,
  language: true,
  autoContext: true,
  streaming: true,
  favoritePromptIds: true,
} satisfies Prisma.AiUserSettingSelect;

const PROMPT_SELECT = {
  id: true,
  slug: true,
  label: true,
  description: true,
  promptText: true,
  contextMode: true,
  position: true,
} satisfies Prisma.AiPromptTemplateSelect;

export type SettingsRow = Prisma.AiUserSettingGetPayload<{ select: typeof SETTINGS_SELECT }>;
export type PromptRow = Prisma.AiPromptTemplateGetPayload<{ select: typeof PROMPT_SELECT }>;

@Injectable()
export class AiSettingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The caller's settings, or null when they have never saved any.
   *
   * Null rather than an upsert-on-read: creating a row the first time
   * someone *looks* at their settings would make a GET a write, and
   * `DEFAULT_AI_SETTINGS` already says what an unsaved user gets. The
   * service supplies those defaults; this reports the truth.
   */
  find(userId: string): Promise<SettingsRow | null> {
    return this.prisma.db.aiUserSetting.findUnique({
      where: { userId },
      select: SETTINGS_SELECT,
    });
  }

  /** API §11.6 — `PUT /me/ai-settings`, the whole document. */
  save(userId: string, input: {
    readonly temperature: number;
    readonly responseLength: AiResponseLength;
    readonly language: AiLanguage;
    readonly autoContext: boolean;
    readonly streaming: boolean;
    readonly favoritePromptIds: readonly string[];
  }): Promise<SettingsRow> {
    const data = {
      temperature: input.temperature,
      responseLength: input.responseLength,
      language: input.language,
      autoContext: input.autoContext,
      streaming: input.streaming,
      favoritePromptIds: [...input.favoritePromptIds],
    };

    return this.prisma.db.aiUserSetting.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
      select: SETTINGS_SELECT,
    });
  }

  /**
   * API §11.5 — the active library, in its curated order.
   *
   * `position` rather than `label`: the order is an editorial decision
   * (the frontend's `AI_PROMPTS` is a hand-ordered array), and sorting
   * alphabetically would put "Check drug interactions" above "Summarize
   * patient" for no reason a reader could see.
   */
  prompts(): Promise<readonly PromptRow[]> {
    return this.prisma.db.aiPromptTemplate.findMany({
      where: { active: true },
      select: PROMPT_SELECT,
      orderBy: { position: 'asc' },
    });
  }

  /** Which of these template ids actually exist, for the PUT's validation. */
  async existingPromptIds(ids: readonly string[]): Promise<readonly string[]> {
    if (ids.length === 0) return [];

    const rows = await this.prisma.db.aiPromptTemplate.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true },
    });

    return rows.map((row) => row.id);
  }
}
