import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';

import { ConfigModule, ConfigService } from '../../config';

import { AccountPasswordController } from './controllers/account-password.controller';
import { AccountSecurityController } from './controllers/account-security.controller';
import { AdminInvitationController } from './controllers/admin-invitation.controller';
import { AuthController } from './controllers/auth.controller';
import { TwoFactorController } from './controllers/two-factor.controller';
import { AccessTokenGuard } from './guards/access-token.guard';
import { MaintenanceModeGuard } from './guards/maintenance-mode.guard';
import { AuthorizationGuard } from '../../shared/authz';
import { AccountSecurityRepository } from './repositories/account-security.repository';
import { IdentityRepository } from './repositories/identity.repository';
import { AccessTokenService } from './services/access-token.service';
import { AccountSecurityService } from './services/account-security.service';
import { AdminBootstrapService } from './services/admin-bootstrap.service';
import { AdminInvitationService } from './services/admin-invitation.service';
import { AuthJobs } from './services/auth.jobs';
import { SuccessorRetentionService } from './services/successor-retention.service';
import { AuthMailService } from './services/auth-mail.service';
import { CredentialLockoutService } from './services/credential-lockout.service';
import { EmailVerificationService } from './services/email-verification.service';
import { LoginEventService } from './services/login-event.service';
import { LoginService } from './services/login.service';
import { OtpChallengeService } from './services/otp-challenge.service';
import { PasswordRecoveryService } from './services/password-recovery.service';
import { PasswordService } from './services/password.service';
import { PermissionService } from './services/permission.service';
import { ReauthenticationService } from './services/reauthentication.service';
import { RecoveryCodeService } from './services/recovery-code.service';
import { RefreshService } from './services/refresh.service';
import { RegistrationService } from './services/registration.service';
import { SecretService } from './services/secret.service';
import { SessionService } from './services/session.service';
import { SessionUserService } from './services/session-user.service';
import { StepUpService } from './services/step-up.service';
import { TotpService } from './services/totp.service';
import { TwoFactorService } from './services/two-factor.service';
import { VerificationTokenService } from './services/verification-token.service';

/**
 * Authentication (RM M6, API §1).
 *
 * Nothing is exported. The rest of the application does not call auth —
 * it is *guarded* by it, through the globally-registered access-token
 * guard and the `common/auth` vocabulary that guard writes onto the
 * request. That inversion is what keeps M2.2's zone 1 intact: eighteen
 * modules depend on being authenticated without importing this one.
 */
@Module({
  imports: [
    // The signing key comes from the validated environment rather than
    // from `process.env` — zone 5 forbids a module reaching `config/env`,
    // and that rule is what keeps the secret behind one typed accessor.
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.env.JWT_SECRET,
        // HS256 is stated, not defaulted: `jsonwebtoken` will verify with
        // whatever algorithm the token's own header names unless it is
        // constrained, which is the `alg: none` family of attacks.
        signOptions: { algorithm: 'HS256' },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
  ],
  controllers: [
    AuthController,
    TwoFactorController,
    AccountPasswordController,
    AccountSecurityController,
    AdminInvitationController,
  ],
  providers: [
    IdentityRepository,
    AccountSecurityRepository,
    SecretService,
    PasswordService,
    PermissionService,
    AccessTokenService,
    SessionService,
    AuthJobs,
    SuccessorRetentionService,
    SessionUserService,
    AccountSecurityService,
    LoginEventService,
    CredentialLockoutService,
    ReauthenticationService,
    OtpChallengeService,
    VerificationTokenService,
    AuthMailService,
    RegistrationService,
    LoginService,
    RefreshService,
    TotpService,
    RecoveryCodeService,
    TwoFactorService,
    StepUpService,
    PasswordRecoveryService,
    EmailVerificationService,
    AdminInvitationService,
    AdminBootstrapService,
    // Global: every route in the application requires a token unless it
    // is marked `@Public()`. Registered here rather than in
    // `app.module.ts` so the guard's dependencies resolve from the module
    // that owns them.
    { provide: APP_GUARD, useClass: AccessTokenGuard },

    // Authorization runs immediately after authentication, and the order
    // is load-bearing rather than tidy: Nest instantiates global guards
    // in module-import order, and `AuthorizationGuard` reads the
    // principal that `AccessTokenGuard` attaches. Registered in the
    // shared kernel it would run first, find no principal, and refuse
    // every authenticated request 401 despite a valid token — which is
    // what it did, across twenty-seven e2e cases, before it moved here.
    //
    // It denies any route that names no rule, so every route in the
    // application carries one of `@Public()`, `@Authenticated()`,
    // `@Roles(...)` or `@Can(...)` (RM M7.1, API §0.4).
    { provide: APP_GUARD, useClass: AuthorizationGuard },

    // Maintenance mode (RM M38.3, API §19.7) reads the principal the two
    // guards above established, so it is registered after them. Running
    // last also means a request refused on authorization is not charged a
    // policy read first.
    { provide: APP_GUARD, useClass: MaintenanceModeGuard },
  ],
})
export class AuthModule {}
