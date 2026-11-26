/**
 * Staff-mediated patient account linking (ADR-048; owner decision
 * 2026-11-26 resolving RA-030.1 / OQ-02) and the patient's own insurance
 * read (contract §4).
 *
 * ## Two proofs, two parties
 *
 * The **code** proves possession of the account: only someone signed in to
 * it can issue one, and it is shown once. The **in-person identity document
 * check** proves the person: staff at the desk look at a document and
 * attest that its holder is the patient on the record. Neither alone links —
 * a code without a desk is a string, and a desk without a code cannot name
 * an account. There is no email matching anywhere on this path (ADR-030):
 * an email address on a clinical record is not evidence that whoever holds
 * the account with that address is that patient.
 *
 * ## Hospital reach
 *
 * Staff link only records their own hospital holds — the masked
 * directory's reach (F-08, OD-07): a Hospital Medical Record at the
 * caller's hospital. Anything else, including a record that does not
 * exist, is the same 404. A Platform Admin holds no patient reach at all
 * (OD-07, §2.1) and gets the same 404.
 *
 * ## What is recorded
 *
 * `patient.account.link` / `patient.account.unlink`, in the same
 * transaction as the change, with the method and the document *type*. No
 * document number is accepted by the schema, so none can be stored.
 */

import { Inject, Injectable } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { AppException } from '../../../common/errors/app.exception';
import { AUDIT_DISPATCHER, TransactionalAuditWriter, type AuditDispatcher } from '../../../shared/audit';
import { TenantContextResolver } from '../../../shared/authz';
import { isUniqueViolation, runAsSystem } from '../../../shared/database';
import type {
  AccountLinkedView,
  AccountUnlinkedView,
  PatientInsuranceView,
  PatientLinkCodeView,
  PatientLinkStatusView,
} from '../dto/patient-account-link.dto';
import type { AccountLinkInput } from '../dto/patient-account-link.schema';
import { PatientAccountLinkRepository } from '../repositories/patient-account-link.repository';
import { generateLinkCode, hashLinkCode, LINK_CODE_TTL_MS, normalizeLinkCode } from './link-code';

const PATIENT_ROLE = 'patient';
/** A digest collision on issue is astronomically unlikely; three tries is plenty. */
const ISSUE_ATTEMPTS = 3;

/** 403 `patient_only` — a `/me/*` patient route called by any other role. */
export function assertPatientRole(user: AuthenticatedUser): void {
  if (user.role !== PATIENT_ROLE) {
    throw AppException.forbidden('This route is available to patient accounts only', 'patient_only');
  }
}

const notFound = (): AppException => AppException.notFound('Patient not found');

const codeInvalid = (): AppException =>
  AppException.validation(
    { code: ['The code is unknown, expired or already used'] },
    'The linking code is not valid',
    'link_code_invalid',
  );

@Injectable()
export class PatientAccountLinkService {
  constructor(
    private readonly links: PatientAccountLinkRepository,
    private readonly tenants: TenantContextResolver,
    private readonly ledger: TransactionalAuditWriter,
    @Inject(AUDIT_DISPATCHER) private readonly audit: AuditDispatcher,
  ) {}

  /** `GET /me/patient-link`. */
  async status(user: AuthenticatedUser): Promise<PatientLinkStatusView> {
    assertPatientRole(user);
    const own = await this.links.ownRecord(user.id);
    return own === null
      ? { linked: false, patient: null }
      : { linked: true, patient: { id: own.publicId, fullName: own.fullName } };
  }

  /** `POST /me/patient-link/code` — a new code, invalidating any earlier one. */
  async issueCode(user: AuthenticatedUser): Promise<PatientLinkCodeView> {
    assertPatientRole(user);
    if ((await this.links.ownRecord(user.id)) !== null) {
      throw AppException.conflict(
        'This account is already linked to a patient record',
        'already_linked',
      );
    }

    for (let attempt = 1; ; attempt += 1) {
      const code = generateLinkCode();
      const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MS);
      try {
        await this.links.replaceCode(user.id, hashLinkCode(code), expiresAt);
      } catch (error) {
        // Another account's live code shares this digest (or a concurrent
        // issue for this account won the one-live-code index). Draw again.
        if (isUniqueViolation(error) && attempt < ISSUE_ATTEMPTS) continue;
        throw error;
      }

      // Never the code, never its digest: the ledger records that one was
      // issued, which is what an investigator of a disputed link needs.
      await this.audit.record({
        action: 'patient.account.link_code_issued',
        actor: { userId: user.id, role: user.role, sessionId: user.sessionId },
        entityType: 'user',
        entityId: user.publicId,
        metadata: { expiresAt: expiresAt.toISOString() },
      });

      return { code, expiresAt: expiresAt.toISOString() };
    }
  }

  /** `POST /patients/:patientId/account-link`. */
  async link(
    user: AuthenticatedUser,
    publicId: string,
    input: AccountLinkInput,
  ): Promise<AccountLinkedView> {
    const { hospitalId, patient } = await this.reachable(user, publicId);

    const code = normalizeLinkCode(input.code);
    if (code === null) throw codeInvalid();

    const now = new Date();
    let outcome;
    try {
      outcome = await this.links.link({
        codeHash: hashLinkCode(code),
        patientId: patient.id,
        actorId: user.id,
        now,
        audit: (tx) =>
          this.ledger.recordWithin(tx, {
            action: 'patient.account.link',
            actor: { userId: user.id, role: user.role, sessionId: user.sessionId },
            entityType: 'patient',
            entityId: patient.publicId,
            hospitalId,
            occurredAt: now,
            metadata: {
              method: input.verification.method,
              documentType: input.verification.documentType,
            },
          }),
      });
    } catch (error) {
      // `patients.user_id` is UNIQUE: the account is linked to a record this
      // hospital cannot see (RLS hides the row, the constraint does not).
      if (isUniqueViolation(error)) outcome = { kind: 'account_already_linked' as const };
      else throw error;
    }

    switch (outcome.kind) {
      case 'linked':
        return { patient: { id: patient.publicId }, linkedAt: outcome.linkedAt.toISOString() };
      case 'code_invalid':
        throw codeInvalid();
      case 'account_not_patient':
        throw AppException.validation(
          { code: ['The code does not belong to a patient account'] },
          'The account is not a patient account',
          'account_not_patient',
        );
      case 'account_already_linked':
        throw AppException.conflict(
          'The account presenting this code is already linked to a patient record',
          'account_already_linked',
        );
      case 'patient_already_linked':
        throw AppException.conflict(
          'This patient record is already linked to an account',
          'patient_already_linked',
        );
      case 'patient_gone':
        throw notFound();
    }
  }

  /** `DELETE /patients/:patientId/account-link` — unlink and end the account's sessions. */
  async unlink(user: AuthenticatedUser, publicId: string): Promise<AccountUnlinkedView> {
    const { hospitalId, patient } = await this.reachable(user, publicId);
    const now = new Date();

    const outcome = await this.links.unlink({
      patientId: patient.id,
      actorId: user.id,
      now,
      audit: (tx) =>
        this.ledger.recordWithin(tx, {
          action: 'patient.account.unlink',
          actor: { userId: user.id, role: user.role, sessionId: user.sessionId },
          entityType: 'patient',
          entityId: patient.publicId,
          hospitalId,
          occurredAt: now,
          metadata: { sessionsRevoked: true },
        }),
    });

    switch (outcome.kind) {
      case 'unlinked':
        return {
          patient: { id: patient.publicId },
          unlinkedAt: outcome.unlinkedAt.toISOString(),
          sessionsRevoked: outcome.sessionsRevoked,
        };
      case 'not_linked':
        throw AppException.conflict(
          'This patient record is not linked to an account',
          'patient_account_not_linked',
        );
      case 'patient_gone':
        throw notFound();
    }
  }

  /** `GET /me/insurance` — the policy on file, last four digits only. */
  async insurance(user: AuthenticatedUser): Promise<PatientInsuranceView> {
    assertPatientRole(user);
    const own = await this.links.ownRecordId(user.id);
    if (own === null) {
      throw AppException.conflict(
        'This account is not linked to a patient record yet',
        'patient_not_linked',
      );
    }

    const row = await this.links.insuranceOf(own);
    return {
      insurance:
        row === null
          ? null
          : {
              providerName: row.provider.name,
              plan: row.plan,
              policyNumberLast4: row.policyNumber.slice(-4),
              validUntil: row.validUntil === null ? null : row.validUntil.toISOString().slice(0, 10),
              isActive: row.isActive,
            },
      authorizations: { available: false, reason: 'authorization_workflow_undecided' },
    };
  }

  /**
   * The record, if the caller's hospital holds it — else the same 404 as a
   * record that does not exist. Resolved from the caller's own staffing
   * (`TenantContextResolver`), never from the request.
   */
  private async reachable(
    user: AuthenticatedUser,
    publicId: string,
  ): Promise<{ hospitalId: string; patient: { id: string; publicId: string } }> {
    const tenant = await runAsSystem(() => this.tenants.resolve(user));
    if (tenant?.scope !== 'hospital' || tenant.hospitalId === undefined) throw notFound();

    const patient = await this.links.findAtHospital(publicId, tenant.hospitalId);
    if (patient === null) throw notFound();

    return { hospitalId: tenant.hospitalId, patient };
  }
}
