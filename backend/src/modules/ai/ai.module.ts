import { Module } from '@nestjs/common';

import { AuditKernelModule } from '../../shared/audit';
import { AuthzKernelModule } from '../../shared/authz';
import { DatabaseModule } from '../../shared/database';

import { AiConversationController } from './controllers/ai-conversation.controller';
import { AiMessageController } from './controllers/ai-message.controller';
import { AiPromptController, AiUserSettingsController } from './controllers/ai-settings.controller';
import { AiContextRepository } from './repositories/ai-context.repository';
import { AiConversationRepository } from './repositories/ai-conversation.repository';
import { AiSettingsRepository } from './repositories/ai-settings.repository';
import { AiContextService } from './services/ai-context.service';
import { AiConversationService } from './services/ai-conversation.service';
import { AiMessageService } from './services/ai-message.service';
import { AiSettingsService } from './services/ai-settings.service';
import { AiJobs } from './services/ai.jobs';

/**
 * AI Assistant — API §11. M16.
 *
 * The doctor-only clinical assistant: threads, server-authoritative
 * context binding, an SSE-streamed answer, settings and the prompt
 * library. All routes require `ai.use`.
 *
 * ## Three rules this module is built around
 *
 * **The provider is not this module's business (M16.1).** Every call to
 * a model goes through `AI_GATEWAY`, a kernel port. `AI_API_KEY` is not
 * reachable from here — `config/`'s own boundary zone sees to that — and
 * no file under `modules/ai` imports a provider SDK. `AiKernelModule` is
 * the one place a binding is chosen, so pointing the deployment at a
 * different provider is one edit in `shared/ai` and none here.
 *
 * **The context is the server's, not the client's (M16.3).** A client
 * sends `{ mode, patientId?, refId? }` and nothing else — no name, no
 * resolved entity, no prompt preamble. `AiContextService` resolves it
 * through `PatientScopeService` and refuses fail-closed: a shape error
 * is 422, an unreachable patient is 404 (never 403 — ADR-022), an
 * unresolvable entity is 409, and each refusal happens before any row is
 * written or any token generated. Re-resolution runs before **every**
 * send, so an assignment revoked after the thread was opened stops the
 * next answer.
 *
 * **Nothing here writes a clinical table (M16.6).**
 * `AiConversationRepository` touches only `ai_*` tables;
 * `AiContextRepository` has no write method at all. The only path from
 * an assistant's output into a chart is a note a doctor wrote and
 * signed, carrying `aiAssisted: true` (M12.4) — and that path is in the
 * records module, behind `records.edit`, where a signature is required.
 * `ai-containment.spec.ts` asserts all of this against the source, so a
 * later edit cannot quietly add a clinical write.
 *
 * `OutboxKernelModule` is absent, deliberately. An assistant answer is
 * not a domain event: nobody is notified that a doctor asked a question,
 * and publishing one would put the question's existence — and, through
 * its thread, the patient it concerns — into a fan-out built for
 * clinical facts.
 */
@Module({
  imports: [DatabaseModule, AuthzKernelModule, AuditKernelModule],
  controllers: [
    AiConversationController,
    AiMessageController,
    AiPromptController,
    AiUserSettingsController,
  ],
  providers: [
    AiConversationService,
    AiConversationRepository,
    AiContextService,
    AiContextRepository,
    AiMessageService,
    AiSettingsService,
    AiSettingsRepository,
    AiJobs,
  ],
})
export class AiModule {}
