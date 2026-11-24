import { Body, Controller, Get, Patch, Put, UploadedFile } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { AppException } from '../../../common/errors/app.exception';
import { FileUpload } from '../../../common/http/file-upload.decorator';
import { zodBody } from '../../../common/validation/zod-validation.pipe';
import { Authenticated, NotPhi, OutsideClinicalStanding } from '../../../shared/authz';
import type { SelfProfileView } from '../dto/self-profile.dto';
import {
  updateDoctorProfileSchema,
  type UpdateDoctorProfileInput,
} from '../dto/self-profile.schema';
import { SelfProfileService } from '../services/self-profile.service';

/**
 * `/me/profile` — the caller's own profile (ADR-036).
 *
 * ## One path, one concept, one owner
 *
 * `PATIENT_MOBILE_API_CONTRACT.md` §2.1 and **API §3.1** both name this
 * path, for the patient's record and the doctor's professional document
 * respectively. Two controllers cannot claim one path: Nest registers
 * both and Express serves whichever module loaded first, which would
 * have made adding the doctor route a silent outage for the patient app
 * rather than a merge conflict.
 *
 * They are not two routes that collided — they are one route. "My
 * profile" is an identity question, and the answer is
 * `{ account, patient, doctor }` with the halves that do not apply set
 * to `null`. That composition needs a module that can build all three,
 * which neither `PatientsModule` nor `DoctorsModule` can without
 * reaching into the other (M2.2 zone 1). `UsersModule` already owns
 * `/me/account` and `/me/activity` and its subject is exactly the
 * caller's own identity, so it owns this too. ADR-036 records the
 * decision; the patient client's view of the payload is unchanged.
 *
 * ## `GET` serves everyone; `PATCH` and `PUT` serve practitioners
 *
 * The asymmetry is deliberate and is not an oversight. API §3.2 is the
 * *doctor* profile document, and a **patient's** profile edit is a
 * different question nobody has answered — which fields a patient may
 * change, and who wins when a clinician edits the same field (ADR-030
 * RA-030.2). There is a document to read and no decision about writing
 * it, so `PATCH` answers 404 for an account with no `doctors` row.
 */
@Authenticated()
// F-09: on the allowlist for an account outside clinical standing.
@OutsideClinicalStanding()
@Controller('me/profile')
export class SelfProfileController {
  constructor(private readonly profiles: SelfProfileService) {}

  /** API §2.1 / §3.1 — the composed document. */
  @NotPhi('the caller’s own profile')
  @Get()
  profile(@CurrentUser() user: AuthenticatedUser): Promise<SelfProfileView> {
    return this.profiles.profile(user.id);
  }

  /**
   * API §3.2 — edit the professional profile.
   *
   * A licence-field edit flips `verificationStatus` back to `pending`
   * and notifies the verification queue, in the same statement as the
   * edit. Returns the whole document rather than 204 so the client
   * re-renders from the server's answer — which matters here, because
   * the status may have changed underneath a field the user did not
   * touch.
   */
  @Patch()
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(updateDoctorProfileSchema)) body: UpdateDoctorProfileInput,
  ): Promise<SelfProfileView> {
    return this.profiles.updateDoctorProfile(user, body);
  }

  /**
   * API §3.3 — the profile photo, multipart.
   *
   * **503 today**, and honestly so: `FILE_STORAGE` is
   * `UnconfiguredFileStorage` until M25.2 wires the adapter, and that
   * stub rejects rather than pretending to store. The route, the
   * multipart parsing and the type and size checks are real — M9.2
   * anticipated exactly this ("stub storage acceptable until M25; same
   * interface").
   *
   * `FileInterceptor` rather than a body schema: the payload is bytes,
   * and Zod has nothing to say about them. The field name is fixed at
   * `photo` so a client cannot decide it.
   */
  @Put('photo')
  @FileUpload('photo')
  updatePhoto(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile()
    file: { originalname: string; mimetype: string; buffer: Buffer } | undefined,
  ): Promise<SelfProfileView> {
    // A request with no file at all is a client bug, and 422 with the
    // field name is what tells them which part was missing.
    if (file === undefined) {
      throw AppException.validation({ photo: ['Attach an image'] }, 'No image attached');
    }

    return this.profiles.updatePhoto(user, file);
  }
}
