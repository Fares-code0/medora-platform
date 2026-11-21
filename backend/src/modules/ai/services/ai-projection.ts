/**
 * Row → view (RM M16.2).
 *
 * Kept out of the services for the reason `record-projection.ts` and
 * `lab-order-projection.ts` are: the mapping from a database row to the
 * frontend's declared shape is where a field name silently drifts, and
 * having it in one place per module means a rename is one edit rather
 * than one per call site.
 */

import { aiChatRoleToWire, aiContextModeToWire, aiMessageStatusToWire } from '../dto/ai-enums';
import type {
  AiConversationDetailView,
  AiConversationView,
  AiContextView,
  AiMessageView,
} from '../dto/ai.dto';
import type {
  ConversationDetailRow,
  ConversationRow,
  MessageRow,
} from '../repositories/ai-conversation.repository';

export function toContextView(row: ConversationRow): AiContextView {
  return {
    mode: aiContextModeToWire(row.contextMode),
    // The `PT-…` handle, never the uuid — no public surface of this API
    // speaks uuids.
    patientId: row.patient?.publicId ?? null,
    // Resolved server-side through the care-scoped query that
    // authorised the binding, so a client cannot put a name on a thread
    // it has no right to see.
    patientName: row.patient?.fullName ?? null,
    refId: row.refPublicId,
  };
}

export function toMessageView(row: MessageRow): AiMessageView {
  return {
    id: row.id,
    role: aiChatRoleToWire(row.role),
    content: row.content,
    createdAt: row.createdAt.toISOString(),
    status: aiMessageStatusToWire(row.status),
    error: row.error,
    feedback: row.feedback,
  };
}

export function toConversationView(row: ConversationRow): AiConversationView {
  return {
    id: row.id,
    title: row.title,
    context: toContextView(row),
    favorite: row.favorite,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    messageCount: row._count.messages,
  };
}

export function toConversationDetailView(row: ConversationDetailRow): AiConversationDetailView {
  return {
    ...toConversationView(row),
    messages: row.messages.map(toMessageView),
  };
}
