import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UploadedFile,
} from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { AppException } from '../../../common/errors/app.exception';
import { FileUpload } from '../../../common/http/file-upload.decorator';
import { zodBody } from '../../../common/validation/zod-validation.pipe';
import { Authenticated, OutsideClinicalStanding, PhiRead } from '../../../shared/authz';
import { uploadFileSchema, type UploadFileBody } from '../dto/files.schema';
import { FilesService } from '../services/files.service';

/**
 * Files — API §17, RM M25.
 *
 * ## `@Authenticated()`, and the authorization is per file
 *
 * §17 marks upload "✓ (kind-scoped)", download "owner/scoped" and delete
 * "owner". None of those is a capability: they are facts about a
 * *pair* — this caller and this file — which a route decorator cannot
 * express, the same reason `PatientScopeService` is a service and not a
 * `@Can`. `FileAccessService` answers them, and answers 404 rather than
 * 403 so that a refusal is not an existence oracle.
 *
 * ## `FileInterceptor`, with the field name fixed
 *
 * The payload is bytes; the field is `file` and a client cannot choose
 * it. `kind` rides in the multipart body as a text field, which is why
 * it is validated separately rather than through `@Body(zodBody(...))`
 * over the whole request — multer hands text fields back as strings, and
 * the one that matters is the one that decides the size and type rules.
 */
@Authenticated()
// F-09: on the allowlist for an account outside clinical standing.
@OutsideClinicalStanding()
@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  /** API §17.1 — multipart upload. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @FileUpload('file')
  upload(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(uploadFileSchema)) body: UploadFileBody,
    @UploadedFile()
    file: { originalname: string; mimetype: string; buffer: Buffer } | undefined,
  ) {
    // A request with no part at all is a client bug, and 422 naming the
    // field is what says which part was missing.
    if (file === undefined) {
      throw AppException.validation({ file: ['Attach a file'] }, 'No file attached');
    }

    return this.files.upload(user, body.kind, file);
  }

  /** The metadata, for a client holding an id it has not yet linked. */
  @PhiRead('file_metadata')
  @Get(':fileId')
  detail(@CurrentUser() user: AuthenticatedUser, @Param('fileId') fileId: string) {
    return this.files.detail(user, fileId);
  }

  /**
   * API §17.2 — the signed URL.
   *
   * A JSON body carrying the URL rather than a 302, and that is a
   * deliberate difference from the contract's "signed short-TTL redirect
   * **or** stream". A redirect puts the signed URL — a bearer credential
   * for the bytes — into the browser's history and into any proxy log on
   * the way; returning it lets the client fetch it without it being
   * recorded as a navigation. It is also what the messaging module
   * already does for its own attachments (`{ url }`), so the two
   * download surfaces answer in one shape.
   */
  @PhiRead('file', { auditedByHandler: true })
  @Get(':fileId/download')
  download(@CurrentUser() user: AuthenticatedUser, @Param('fileId') fileId: string) {
    return this.files.downloadUrl(user, fileId);
  }

  /** API §17.3 — soft delete. */
  @Delete(':fileId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthenticatedUser, @Param('fileId') fileId: string): Promise<void> {
    return this.files.remove(user, fileId);
  }
}
