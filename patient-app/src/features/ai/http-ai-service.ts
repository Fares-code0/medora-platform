import { patientAiEndpoints, type WireAiConversation } from '@/api/endpoints/patient-ai';

import type { AiConversationSummary, AiMessage, AiService } from './model/types';

/**
 * The HTTP adapter: wire shapes in, domain shapes out.
 *
 * The only judgement made here is the author: the server's `role` is
 * `user`/`assistant` in either case, and anything that is not `user` is
 * rendered as the assistant's — a role this client does not recognise
 * must not be attributed to the patient.
 */
function toSummary(wire: WireAiConversation): AiConversationSummary {
  return { id: wire.id, mode: wire.mode, title: wire.title ?? null, createdAt: wire.createdAt };
}

export const httpAiService: AiService = {
  async createConversation(mode) {
    const { data } = await patientAiEndpoints.createConversation(mode);
    return toSummary(data);
  },

  async listConversations() {
    const { data } = await patientAiEndpoints.listConversations();
    return data.map(toSummary);
  },

  async getConversation(id) {
    const { data } = await patientAiEndpoints.getConversation(id);
    const messages: AiMessage[] = data.messages.map((message) => ({
      id: message.id,
      author: message.role === 'user' ? 'patient' : 'assistant',
      body: message.content,
      at: message.createdAt,
      ...(message.escalated ? { escalated: true } : {}),
    }));
    return { ...toSummary(data), messages };
  },

  async deleteConversation(id) {
    await patientAiEndpoints.deleteConversation(id);
  },

  sendMessage(conversationId, content, signal) {
    return patientAiEndpoints.sendMessage(conversationId, content, signal);
  },
};
