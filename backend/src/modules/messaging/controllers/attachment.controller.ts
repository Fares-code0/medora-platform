import { Controller, Get, Param } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { Can, PhiRead } from '../../../shared/authz';
import { AttachmentService } from '../services/attachment.service';

/**
 * `GET /attachments/{id}/download` — API §9.10, RM M20.4.
 *
 * Answers a short-TTL signed URL rather than the bytes. ADR-019 §2's
 * file kernel records the reasoning: streaming every attachment through
 * the API turns the app into a file server and puts PHI in response
 * timings for no benefit.
 *
 * The scan gate lives in the service, ahead of the storage call, so an
 * unscanned file never reaches the point where a URL could be minted.
 */
@Can('messages.send')
@Controller('attachments')
export class AttachmentController {
  constructor(private readonly attachments: AttachmentService) {}

  @PhiRead('message_attachment')

  @Get(':attachmentId/download')
  download(
    @CurrentUser() user: AuthenticatedUser,
    @Param('attachmentId') attachmentId: string,
  ): Promise<{ url: string }> {
    return this.attachments.downloadUrl(user.id, attachmentId);
  }
}
