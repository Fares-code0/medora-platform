import { Module } from '@nestjs/common';

import { AuditKernelModule } from '../../shared/audit';
import { DatabaseModule } from '../../shared/database';
import { FileStorageKernelModule } from '../../shared/files';

import { AttachmentController } from './controllers/attachment.controller';
import { ConversationController } from './controllers/conversation.controller';
import { MessageSearchController } from './controllers/message-search.controller';
import { OversightController } from './controllers/oversight.controller';
import { ConversationRepository } from './repositories/conversation.repository';
import { OversightRepository } from './repositories/oversight.repository';
import { MessageRepository } from './repositories/message.repository';
import { AttachmentService } from './services/attachment.service';
import { ConversationService } from './services/conversation.service';
import { MessageService } from './services/message.service';
import { OversightService } from './services/oversight.service';

/**
 * Messaging — API §9. M20.
 *
 * Threads, their per-viewer state, the delivery-state progression, the
 * five-minute edit window and own-thread search.
 *
 * **Two authorization questions, both asked.** `can:messages.send`
 * decides whether messaging exists for a role; the
 * `conversation_participants` join decides which threads. A doctor with
 * the capability still gets 404 on a colleague's thread, and a thread
 * the caller is not in is never loaded rather than loaded and rejected.
 *
 * **Per-viewer state lives on the participant row** — unread count,
 * pinned, starred, archived, muted and the draft. DB §14.5 says why, and
 * the sharpest case is the draft: on the thread row it would be visible
 * to everyone in it.
 *
 * Not built here, and each for a stated reason:
 *
 * · **M20.4 uploading** — the scan gate ships on the download path, but
 *   `POST …/attachments` needs `FILE_STORAGE.put`, whose stub rejects
 *   every call with 503 until **M25**, and the scanner that sets
 *   `scanned_at` is **M25.3**. Nothing here may set that column, or the
 *   gate would be a door with its own key taped to it. See RA-M20.1.
 * · **M20.6 presence** — RM names a Redis TTL heartbeat and there is no
 *   Redis client in the project; **M31** owns it. A per-process map
 *   would report a colleague offline to half the replicas.
 * · **M20.7 admin oversight** ships in `OversightController`. Issuing a
 *   grant fails closed until `COMMUNICATION_GRANT_TTL_MINUTES` is set:
 *   ADR-006 §4 requires grants to expire and **RA-006.3** records that
 *   no source gives a duration.
 */
@Module({
  imports: [DatabaseModule, FileStorageKernelModule, AuditKernelModule],
  controllers: [
    ConversationController,
    MessageSearchController,
    AttachmentController,
    OversightController,
  ],
  providers: [
    ConversationService,
    ConversationRepository,
    MessageService,
    MessageRepository,
    AttachmentService,
    OversightService,
    OversightRepository,
  ],
})
export class MessagingModule {}
