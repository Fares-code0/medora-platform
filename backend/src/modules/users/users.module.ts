import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../shared/database';

import { AccountController } from './controllers/account.controller';
import { PlatformUserController } from './controllers/platform-user.controller';
import { RolesController } from './controllers/roles.controller';
import { SelfProfileController } from './controllers/self-profile.controller';
import { AccountRepository } from './repositories/account.repository';
import { PlatformUserRepository } from './repositories/platform-user.repository';
import { RolesRepository } from './repositories/roles.repository';
import { SelfProfileRepository } from './repositories/self-profile.repository';
import { AccountService } from './services/account.service';
import { PlatformUserService } from './services/platform-user.service';
import { RolesService } from './services/roles.service';
import { SelfProfileService } from './services/self-profile.service';

/**
 * Users & Account — API §2 and §15. M8.
 *
 * Built here: the caller's own account document and its patch (§2.1,
 * §2.2), the activity feed (§2.8), and the administrator's account list
 * and role/status patch (§2.10).
 *
 * **And `/me/profile` (ADR-036).** That route is not API §2's — it is
 * the patient contract's §2.1 and API §3.1, which name the same path for
 * two different documents. One route, one composed answer
 * (`{ account, patient, doctor }`), and it lives here because neither
 * `PatientsModule` nor `DoctorsModule` can build all three halves
 * without reaching into the other, while "the caller's own identity" is
 * exactly what this module is. `PATCH` edits the professional half
 * (API §3.2) and `PUT /me/profile/photo` the photo (§3.3).
 *
 * **Not here, deliberately, and each for a stated reason:**
 *
 * · `POST /me/password` (§2.3), `/me/2fa/*` (§2.9), `/me/sessions`
 *   (§2.4–2.5), `/me/devices` (§2.6) and `/me/login-history` (§2.7) are
 *   in the **auth** module. They act on the identity aggregate —
 *   credentials, sessions, login events — which `IdentityRepository`
 *   documents as one aggregate rather than five tables, and M2.2's zone
 *   1 would not let this module borrow the hasher or the session
 *   revoker in any case.
 *
 * · `POST /admin/users` (§2.10's invite) is
 *   `POST /auth/admin-invitations` (ADR-035 §5). See
 *   `platform-user.controller.ts` for why there is not a second one.
 *
 * API §15's roles-and-permissions endpoints are here too (M7.4). The
 * matrix algebra, the locks and `lockViolations` were built in
 * `shared/authz` at M7 with no endpoint on top of them; `RolesController`
 * is that endpoint. It belongs beside the account list rather than
 * inside the kernel, which must not depend on a controller.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [AccountController, SelfProfileController, PlatformUserController, RolesController],
  providers: [
    AccountService,
    AccountRepository,
    PlatformUserService,
    PlatformUserRepository,
    RolesService,
    RolesRepository,
    SelfProfileService,
    SelfProfileRepository,
  ],
})
export class UsersModule {}
