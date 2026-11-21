import { mockAiService } from './mock/mock-ai-service';
import type { AiService } from './model/ai-service';

/**
 * The assistant seam's selection point — the only module the feature
 * imports (`docs/handoff/auth-seam.md` §1, rule 3), and the only one that
 * would ever read the mock flag (rule 5).
 *
 * It reads no flag today, and that is deliberate rather than unfinished.
 * The backend does serve `/ai/*` (`backend/src/modules/ai`, FE-10 F40), but
 * the assistant is held at D-09 until Phase 28: under the multi-hospital
 * model the server must bind the hospital and keep cross-hospital content
 * out of a reply (WEB-9, DR-12) before a live adapter can be pointed at it.
 * Until then `selectService({ mock, http })` has no `http` adapter it could
 * honestly take.
 *
 * **What is NOT deferred is the honesty of the answers.** Every canned reply
 * carries its own disclaimer naming itself as mock output built from seeded
 * demo data (`model/responses.ts`), and `ChatPanel` repeats it under the
 * composer, so a doctor is never shown clinical prose that presents itself
 * as a model's. Those two statements are the reason this seam can ship with
 * one adapter without misleading anyone; they are not decoration, and they
 * come out only when a real model is behind `generateReply`.
 */
export const aiService: AiService = mockAiService;
