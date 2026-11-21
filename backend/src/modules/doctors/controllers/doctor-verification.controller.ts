import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { zodBody } from '../../../common/validation/zod-validation.pipe';
import { Authenticated } from '../../../shared/authz';
import type { VerificationDocumentView } from '../dto/admin-doctor.dto';
import {
  submitVerificationDocumentSchema,
  type SubmitVerificationDocumentInput,
} from '../dto/doctor-verification.schema';
import { DoctorVerificationService } from '../services/doctor-verification.service';

/**
 * The doctor's own verification documents (frontend checklist NEW-46).
 *
 * `@Authenticated()`, not a capability, for the reason
 * `AvailabilityController` gives: "is this account a practitioner" is a
 * question the `doctors` row answers. An account without one gets 404
 * from the service, so a patient or an administrator reaches nothing.
 *
 * Two steps, as a record attachment is: `POST /files` with
 * `kind=verification_document` stores and scans the bytes, then
 * `POST /me/verification-documents` files that id. The reviewer reads the
 * same rows on `GET /doctors/:id` (API §3.5) and decides on them (§3.6).
 */
@Authenticated()
@Controller('me/verification-documents')
export class DoctorVerificationController {
  constructor(private readonly verification: DoctorVerificationService) {}

  /** What this doctor has filed, newest first, each with its decision. */
  @Get()
  list(@CurrentUser() user: AuthenticatedUser): Promise<readonly VerificationDocumentView[]> {
    return this.verification.list(user);
  }

  /** File an upload: 201 with the document, `pending` until a reviewer decides. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  submit(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(submitVerificationDocumentSchema)) body: SubmitVerificationDocumentInput,
  ): Promise<VerificationDocumentView> {
    return this.verification.submit(user, body);
  }
}
