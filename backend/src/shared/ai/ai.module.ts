import { Module } from '@nestjs/common';

import { AI_GATEWAY } from './ai-gateway.types';
import { AiTranscriptLog } from './ai-transcript.log';
import { UnconfiguredAiGateway } from './unconfigured-ai-gateway';

/**
 * Binds `AI_GATEWAY` to the 503 stub; a provider adapter swaps in here
 * and nowhere else (RM M16.1).
 *
 * The module is what makes "no other module talks to a provider"
 * structural rather than a convention: `AI_API_KEY` is reachable only
 * from this folder, the token is the only thing exported, and M2.2's
 * zone 2 stops any module importing past `shared/ai/index.ts`.
 */
@Module({
  providers: [
    { provide: AI_GATEWAY, useClass: UnconfiguredAiGateway },
    AiTranscriptLog,
  ],
  exports: [AI_GATEWAY, AiTranscriptLog],
})
export class AiKernelModule {}
