/**
 * Wire vocabularies for messaging (API §9, ADR-023 §2).
 *
 * The same shape every module uses: a `Record` in each direction rather
 * than a cast, so adding a member to the Prisma enum without adding its
 * wire spelling stops the build instead of serialising `SENT` to a
 * client expecting `sent`.
 */

import {
  AttachmentKind,
  ConversationKind,
  MessageKind,
  MessageStatus,
} from '../../../generated/prisma/enums';

export const FOLDER_VALUES = [
  'inbox',
  'unread',
  'starred',
  'sent',
  'drafts',
  'archived',
] as const;

export type MessagingFolder = (typeof FOLDER_VALUES)[number];

export const STATUS_TO_WIRE: Record<MessageStatus, string> = {
  SENDING: 'sending',
  SENT: 'sent',
  DELIVERED: 'delivered',
  READ: 'read',
  FAILED: 'failed',
};

export const KIND_TO_WIRE: Record<MessageKind, string> = {
  TEXT: 'text',
  SYSTEM: 'system',
};

export const CONVERSATION_KIND_TO_WIRE: Record<ConversationKind, string> = {
  DIRECT: 'direct',
  GROUP: 'group',
  ANNOUNCEMENT: 'announcement',
  SYSTEM: 'system',
};

export const ATTACHMENT_KIND_TO_WIRE: Record<AttachmentKind, string> = {
  FILE: 'file',
  IMAGE: 'image',
};
