/**
 * Public API — the LLM gateway (RM M16.1).
 *
 * The token and the shapes a caller needs to build a request, and
 * nothing else. `UnconfiguredAiGateway` is deliberately absent: a module
 * that could name the concrete class could construct one, and the point
 * of the token is that the binding is the kernel's decision.
 */
export { AiKernelModule } from './ai.module';
export {
  AI_GATEWAY,
  type AiDelta,
  type AiGatewayPort,
  type AiGenerationRequest,
  type AiModelDescription,
  type AiRole,
  type AiTurn,
} from './ai-gateway.types';
export {
  AI_LOG_RETENTION_DAYS,
  AiTranscriptLog,
  type AiTranscriptRecord,
} from './ai-transcript.log';
