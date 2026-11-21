/**
 * Request validation for messaging (API §9).
 *
 * ## The body limit is a product of the column, not a guess
 *
 * `messages.body` is `text`, so Postgres imposes no useful ceiling. An
 * unbounded body is a way to fill the disk one POST at a time, and a
 * thread the UI cannot render is not a message anyone received. 16 000
 * characters is the cap — well above any clinical note a composer
 * produces, well below anything that troubles a page render.
 */

import { z } from 'zod';

import { FOLDER_VALUES } from './messaging-enums';

const UUID = z.string().uuid();

export const conversationQuerySchema = z.object({
  folder: z.enum(FOLDER_VALUES).default('inbox'),
  q: z.string().trim().min(1).max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type ConversationQuery = z.infer<typeof conversationQuerySchema>;

/**
 * `participantIds` excludes the caller, who is always added.
 *
 * A client that had to include itself would eventually forget, and the
 * thread would be created with no author in it — recoverable only by an
 * administrator. The cap of 50 keeps a "group" a group rather than a
 * broadcast list; announcements are M23.5's surface, not this one.
 */
export const createConversationSchema = z.object({
  participantIds: z.array(UUID).min(1).max(50),
  topic: z.string().trim().min(1).max(200).optional(),
  patientId: UUID.optional(),
});

export type CreateConversationBody = z.infer<typeof createConversationSchema>;

export const sendMessageSchema = z.object({
  body: z.string().trim().min(1).max(16_000),
  attachmentIds: z.array(UUID).max(10).optional(),
});

export type SendMessageBody = z.infer<typeof sendMessageSchema>;

export const editMessageSchema = z.object({
  body: z.string().trim().min(1).max(16_000),
});

export type EditMessageBody = z.infer<typeof editMessageSchema>;

export const markReadSchema = z.object({
  messageId: UUID,
});

export type MarkReadBody = z.infer<typeof markReadSchema>;

/**
 * API §9.7 — per-viewer thread state.
 *
 * Every field optional and at least one required: each control writes
 * exactly one, and an empty patch is a client bug worth a 422 rather
 * than a silent no-op that looks like it worked.
 */
export const patchConversationSchema = z
  .object({
    pinned: z.boolean().optional(),
    starred: z.boolean().optional(),
    archived: z.boolean().optional(),
    muted: z.boolean().optional(),
    draft: z.string().max(16_000).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  });

export type PatchConversationBody = z.infer<typeof patchConversationSchema>;

export const messageSearchSchema = z.object({
  q: z.string().trim().min(2).max(120),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export type MessageSearchQuery = z.infer<typeof messageSearchSchema>;

export const threadQuerySchema = z.object({
  /** Cursor pagination: messages before this id, newest first (API §9.3). */
  before: UUID.optional(),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export type ThreadQuery = z.infer<typeof threadQuerySchema>;
