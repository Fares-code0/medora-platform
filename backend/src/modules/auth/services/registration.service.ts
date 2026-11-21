import { HttpStatus, Inject, Injectable } from '@nestjs/common';

import { AppException } from '../../../common/errors/app.exception';
import { AUDIT_DISPATCHER, type AuditDispatcher } from '../../../shared/audit';
import { isUniqueViolation } from '../../../shared/database';
import { TokenKind } from '../../../generated/prisma/enums';
import type { RegisterInput } from '../dto';
import { IdentityRepository } from '../repositories/identity.repository';

import { AuthMailService } from './auth-mail.service';
import { PasswordService } from './password.service';
import {
  EMAIL_VERIFICATION_TTL_SECONDS,
  VerificationTokenService,
} from './verification-token.service';

/**
 * `POST /auth/register` (RM M6.1, API §1.1, ADR-035).
 *
 * ## The two roles this endpoint accepts
 *
 * `patient` and `doctor`. Both are *public* registrations, and the
 * difference between them is what the account must declare, not how it
 * authenticates — see `register.schema.ts`.
 *
 * **`admin` is not one of them, and its removal is the point of ADR-035
 * §5.** This endpoint used to accept `role: 'admin'` from anyone who
 * could reach it. An earlier revision of this comment named that as a
 * risk and deferred it to M8.2 as RA-025.1, on the reasoning that "until
 * M7 an admin account has no more reach than a doctor one". M7 shipped.
 * An administrator now holds `roles.manage`, `settings.manageSystem`,
 * `patients.revealIdentity` and `logs.export`, so the premise the
 * deferral rested on is gone. Administrators are provisioned by
 * invitation (`admin-invitation.service.ts`) and the DTO no longer has a
 * value for them, so this file needs no `role === 'admin'` branch to
 * refuse: the request never parses.
 *
 * ## What a doctor registration now creates
 *
 * A `doctors` row, in the account transaction, with
 * `verification_status = PENDING`. Before ADR-035 it did not, because the
 * form collected a bare licence number and `doctors.specialty` is NOT
 * NULL — so a self-registered doctor had a professional number on
 * `users.license_number` and no professional profile, and the
 * verification queue could not see them. The form now collects what the
 * row requires, so the row can be created honestly.
 *
 * PENDING is a claim about Medora's own state and not about the
 * practitioner: it says "nobody has checked this number", which is true.
 * No external register is integrated, nothing here contacts one, and
 * nothing in this file ever writes VERIFIED — that transition belongs to
 * an administrator holding `doctors.verify`, or to the integration ADR-035
 * §4 leaves open.
 *
 * ## What a patient registration creates
 *
 * An account and nothing else — no `patients` row and no link to one
 * (ADR-030 §4). Claiming a clinical record asserts "I am the person in
 * PT-1042", and a wrong assertion discloses one person's medical history
 * to another; that is a different problem with a different risk profile,
 * and RA-030.1 still owns it. A patient principal resolves to zero
 * capabilities, so every `@Can(...)` route denies it (ADR-030 §6).
 */
export interface RegisterResult {
  readonly nextStep: 'verify-email';
  readonly email: string;
}

@Injectable()
export class RegistrationService {
  constructor(
    private readonly identity: IdentityRepository,
    private readonly passwords: PasswordService,
    private readonly tokens: VerificationTokenService,
    private readonly mail: AuthMailService,
    @Inject(AUDIT_DISPATCHER) private readonly audit: AuditDispatcher,
  ) {}

  async register(input: RegisterInput, ipAddress?: string): Promise<RegisterResult> {
    const email = normalizeEmail(input.email);

    // A pre-check as well as the constraint below. Both are needed: this
    // one answers the ordinary case with the contract's 409 rather than
    // a database error, and the constraint is what makes it correct when
    // two registrations for one address arrive together.
    if ((await this.identity.findByEmail(email)) !== null) {
      throw emailTaken();
    }

    const role = await this.identity.findRoleByCode(input.role);
    if (role === null) {
      // The five platform roles are seeded (RM M5.1). Missing means the
      // seed did not run — an operator problem, not a caller problem, so
      // it must not be reported as a bad request.
      throw new AppException(HttpStatus.SERVICE_UNAVAILABLE, {
        message: 'Account roles are not configured',
        code: 'service_unavailable',
        detail: `Role \`${input.role}\` is not seeded`,
      });
    }

    // The professional number is unique across `doctors`, so a duplicate
    // has to be answered before the account is created rather than after
    // — a 500 here would leave the `users` row behind and the address
    // permanently unregisterable.
    if (input.role === 'doctor' && (await this.identity.professionalNumberTaken(
      input.professionalRegistrationNumber,
    ))) {
      throw professionalNumberTaken();
    }

    const passwordHash = await this.passwords.hash(input.password);
    const consentedAt = new Date();

    let user;
    try {
      user = await this.identity.createAccount({
        publicId: IdentityRepository.generatePublicId(),
        firstName: input.firstName,
        lastName: input.lastName,
        displayName: displayNameFor(input),
        email,
        phone: input.phone,
        roleId: role.id,
        // `users.license_number` keeps the value it has always held, so
        // nothing that already reads the column regresses. `doctors
        // .license_number` below is the authoritative one — it is the
        // column with the UNIQUE index and the one the verification queue
        // reads (ADR-035 §4).
        ...(input.role === 'doctor'
          ? { licenseNumber: input.professionalRegistrationNumber }
          : {}),
        passwordHash,
        consentedAt,
        ...(input.role === 'doctor'
          ? {
              doctorProfile: {
                fullName: `${input.firstName} ${input.lastName}`.trim(),
                specialty: input.specialty,
                licenseNumber: input.professionalRegistrationNumber,
                professionalCategory: input.professionalCategory,
                licenseExpiresOn:
                  input.registrationExpiresOn === undefined
                    ? undefined
                    : new Date(input.registrationExpiresOn),
                contactEmail: email,
                contactPhone: input.phone,
              },
            }
          : {}),
      });
    } catch (error) {
      // P2002 on `users.email` — the loser of a concurrent signup. It is
      // the same situation as the pre-check above and gets the same
      // answer, because from the caller's side it *is* the same thing.
      if (isUniqueViolation(error, 'email')) throw emailTaken();
      // And the same race on the professional number, which the pre-check
      // above cannot win either. Both spellings, because the reported
      // target is the Prisma field name on one client path and the
      // database column name on the driver-adapter path.
      if (
        isUniqueViolation(error, 'license_number') ||
        isUniqueViolation(error, 'licenseNumber')
      ) {
        throw professionalNumberTaken();
      }
      throw error;
    }

    const token = await this.tokens.issue(
      user.id,
      TokenKind.EMAIL_VERIFICATION,
      EMAIL_VERIFICATION_TTL_SECONDS,
    );
    await this.mail.sendEmailVerification(email, token.raw, user.displayName);

    await this.audit.record({
      action: 'user.register',
      actor: {
        userId: user.id,
        role: role.code,
        ...(ipAddress === undefined ? {} : { ipAddress }),
      },
      entityType: 'user',
      entityId: user.publicId,
      // Field names, never values (MG §11.6) — the role is a category,
      // the two consent flags are the compliance record MG §11.8 wants.
      //
      // `professionalVerification` records the state the account was
      // *created* in, never the number itself. An audit reader needs to
      // know that a clinician account entered the platform unverified;
      // it does not need the registration number, and MG §11.6 is why it
      // does not get it.
      metadata: {
        role: role.code,
        termsAccepted: true,
        privacyAccepted: true,
        ...(input.role === 'doctor' ? { professionalVerification: 'PENDING' } : {}),
      },
    });

    return { nextStep: 'verify-email', email };
  }
}

/**
 * 409 `email_taken` — the code `SignupPage` branches on.
 *
 * The 409 says nothing beyond "this address is in use", which the
 * signup form already reveals by asking. This is *not* the enumeration
 * leak API §1.2 guards against: that one is about login, where the
 * answer must be identical whether or not the account exists.
 */
function emailTaken(): AppException {
  return AppException.conflict(
    'An account with this email already exists',
    'email_taken',
    'Email already registered',
  );
}

/**
 * 409 `professional_number_taken` (ADR-035 §4).
 *
 * A registration number identifies one practitioner — `doctors
 * .license_number` is UNIQUE for that reason — so a second account
 * claiming one is either a typo or an impersonation attempt, and both
 * want the same answer.
 *
 * The message says the number is already registered and nothing else. It
 * does not name the account holding it: "this number belongs to
 * dr.chen@…" would turn the signup form into a way of resolving a
 * professional number to a person's address.
 */
function professionalNumberTaken(): AppException {
  return AppException.conflict(
    'That professional registration number is already registered',
    'professional_number_taken',
    'Professional registration number already in use',
  );
}

/**
 * `SessionUser.name` (API §1.2) — "Dr. Amelia Chen".
 *
 * The seeded mock users show the convention: every doctor carries the
 * honorific, the administrator does not. It is stored rather than
 * derived at read time because `displayName` is what a doctor may later
 * edit in settings, and a derived value has nowhere to keep an edit.
 *
 * A patient falls through to the plain name, which is the whole of what
 * ADR-030 needs here — the honorific is a professional title, not a
 * courtesy, and prefixing a patient with one would be wrong rather than
 * merely odd.
 */
function displayNameFor(input: RegisterInput): string {
  const name = `${input.firstName} ${input.lastName}`.trim();
  return input.role === 'doctor' ? `Dr. ${name}` : name;
}

/** Whitespace only. Case is `citext`'s job (DB §A4), not the caller's. */
function normalizeEmail(email: string): string {
  return email.trim();
}
