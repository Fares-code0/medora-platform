/**
 * Persistence for staff-mediated account linking (ADR-048) and the
 * patient's own insurance read (contract §4).
 *
 * Every write that changes who an account *is* runs in one transaction with
 * its audit row and, for an unlink, with the revocation of the account's
 * sessions — so the link, the record of it and the end of the old sessions
 * commit together or not at all.
 *
 * Session revocation reuses the platform's existing mechanism rather than a
 * new one: `sessions.revoked_at` (which the access-token guard checks on
 * every request, PRE-01) plus a bump of `users.authz_version` (ADR-046), as
 * `SessionService.revokeAllFor` and the hospital-staffing repository do.
 */

import { Injectable } from '@nestjs/common';

import type { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../shared/database';

export interface LinkTarget {
  readonly id: string;
  readonly publicId: string;
  readonly userId: string | null;
}

export type LinkOutcome =
  | { readonly kind: 'linked'; readonly linkedAt: Date }
  | { readonly kind: 'code_invalid' }
  | { readonly kind: 'account_not_patient' }
  | { readonly kind: 'account_already_linked' }
  | { readonly kind: 'patient_already_linked' }
  | { readonly kind: 'patient_gone' };

export type UnlinkOutcome =
  | {
      readonly kind: 'unlinked';
      readonly unlinkedAt: Date;
      readonly sessionsRevoked: number;
      readonly personalAiThreadsDeleted: number;
    }
  | { readonly kind: 'not_linked' }
  | { readonly kind: 'patient_gone' };

const PATIENT_ROLE = 'patient';

@Injectable()
export class PatientAccountLinkRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The caller's own linked record, or `null`. Deactivated records do not count. */
  ownRecord(userId: string): Promise<{ publicId: string; fullName: string } | null> {
    return this.prisma.db.patient.findFirst({
      where: { userId },
      select: { publicId: true, fullName: true },
    });
  }

  /** The caller's own linked record id, or `null`. */
  async ownRecordId(userId: string): Promise<string | null> {
    const row = await this.prisma.db.patient.findFirst({ where: { userId }, select: { id: true } });
    return row?.id ?? null;
  }

  /**
   * Replaces every unused code of the account with this one.
   *
   * Delete-then-insert in one transaction: the partial unique index
   * (`one_live_per_user`) would refuse a second unused row anyway, and a
   * superseded code is worth nothing to keep — it is a digest of a value
   * that can no longer be used.
   */
  async replaceCode(userId: string, codeHash: string, expiresAt: Date): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.patientAccountLinkCode.deleteMany({ where: { userId, usedAt: null } });
      await tx.patientAccountLinkCode.create({ data: { userId, codeHash, expiresAt } });
    });
  }

  /** A record by its handle, provided it holds a Hospital Medical Record at `hospitalId`. */
  findAtHospital(publicId: string, hospitalId: string): Promise<LinkTarget | null> {
    return this.prisma.db.patient.findFirst({
      where: { publicId, hospitalMedicalRecords: { some: { hospitalId } } },
      select: { id: true, publicId: true, userId: true },
    });
  }

  /**
   * Consumes the code and links its account to `patientId`, atomically.
   *
   * Row locks in a fixed order — the code, then the patient — so two desks
   * presenting the same code, or linking the same record, serialize: the
   * second sees `used_at` set (or `user_id` taken) and is refused rather
   * than racing to a double link. `patients.user_id` is also `UNIQUE`, the
   * backstop for an account already linked to a record this hospital cannot
   * see (RLS hides it; the constraint does not).
   */
  async link(input: {
    readonly codeHash: string;
    readonly patientId: string;
    readonly actorId: string;
    readonly now: Date;
    readonly audit: (tx: Prisma.TransactionClient) => Promise<void>;
  }): Promise<LinkOutcome> {
    return this.prisma.$transaction(async (tx) => {
      const codes = await tx.$queryRaw<{ id: string; user_id: string; expires_at: Date; used_at: Date | null }[]>`
        SELECT id, user_id, expires_at, used_at
          FROM public.patient_account_link_codes
         WHERE code_hash = ${input.codeHash}
         FOR UPDATE`;
      const code = codes[0];
      if (code === undefined || code.used_at !== null || code.expires_at.getTime() <= input.now.getTime()) {
        return { kind: 'code_invalid' };
      }

      const account = await tx.user.findFirst({
        where: { id: code.user_id, deletedAt: null },
        select: { role: { select: { code: true } } },
      });
      if (account === null) return { kind: 'code_invalid' };
      if (account.role.code !== PATIENT_ROLE) return { kind: 'account_not_patient' };

      const patients = await tx.$queryRaw<{ user_id: string | null }[]>`
        SELECT user_id FROM public.patients
         WHERE id = ${input.patientId}::uuid AND deleted_at IS NULL
         FOR UPDATE`;
      const patient = patients[0];
      if (patient === undefined) return { kind: 'patient_gone' };
      if (patient.user_id !== null) return { kind: 'patient_already_linked' };

      const existing = await tx.patient.findFirst({
        where: { userId: code.user_id },
        select: { id: true },
      });
      if (existing !== null) return { kind: 'account_already_linked' };

      await tx.patient.update({
        where: { id: input.patientId },
        data: { userId: code.user_id, updatedBy: input.actorId },
      });
      await tx.patientAccountLinkCode.update({ where: { id: code.id }, data: { usedAt: input.now } });
      await input.audit(tx);

      return { kind: 'linked', linkedAt: input.now };
    });
  }

  /**
   * Unlinks the record and ends every session of the account it was linked
   * to, in one transaction — so the device that held the patient's data
   * loses its access with the link, not at the next token expiry.
   *
   * The same transaction hard-deletes the account's **personal** assistant
   * threads (`patient_mode = 'personal'`, ADR-050) and their turns (audit
   * R-04). A personal thread is owned by the account, not the record, and
   * its turns were answered from the record being unlinked; kept, they
   * would stay readable and be replayed to the model next to whichever
   * record the account is linked to next. Soft-deleted threads go too —
   * `deleted_at` hides a row from the API, not from the table. General
   * threads stay: their prompt carries no record data by construction
   * (`buildGeneralPatientPrompt` takes only a locale). If any delete fails,
   * the unlink rolls back with it, so old context is never left servable
   * behind a completed unlink.
   *
   * Must run under `system` scope (see the service): `ai_conversations`
   * admits a DELETE only from its owner or `system`, and the caller here is
   * the hospital admin, under whom the deletes would silently match nothing.
   */
  async unlink(input: {
    readonly patientId: string;
    /** The caller's hospital, from `reachable()`; re-checked under the lock. */
    readonly hospitalId: string;
    readonly actorId: string;
    readonly now: Date;
    readonly audit: (
      tx: Prisma.TransactionClient,
      facts: { readonly personalAiThreadsDeleted: number },
    ) => Promise<void>;
  }): Promise<UnlinkOutcome> {
    return this.prisma.$transaction(async (tx) => {
      // Reach is re-checked under the lock: the transaction runs under
      // `system` scope (R-04), so the caller's RLS no longer narrows this
      // select — the record must still be held by the caller's hospital.
      const patients = await tx.$queryRaw<{ user_id: string | null }[]>`
        SELECT p.user_id FROM public.patients p
         WHERE p.id = ${input.patientId}::uuid AND p.deleted_at IS NULL
           AND EXISTS (SELECT 1 FROM public.hospital_medical_records r
                        WHERE r.patient_id = p.id AND r.hospital_id = ${input.hospitalId}::uuid)
         FOR UPDATE OF p`;
      const patient = patients[0];
      if (patient === undefined) return { kind: 'patient_gone' };
      if (patient.user_id === null) return { kind: 'not_linked' };
      const userId = patient.user_id;

      await tx.patient.update({
        where: { id: input.patientId },
        data: { userId: null, updatedBy: input.actorId },
      });
      const revoked = await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: input.now, rotatedAt: null, successorTokenCt: null },
      });
      await tx.user.update({ where: { id: userId }, data: { authzVersion: { increment: 1 } } });
      await tx.patientAccountLinkCode.deleteMany({ where: { userId, usedAt: null } });

      // R-04. Turns first, explicitly, rather than relying on the
      // `ai_messages` ON DELETE CASCADE alone: the intent reads in the code,
      // and the delete is subject to the same RLS as the parent.
      const personal = { ownerId: userId, patientMode: 'personal' } as const;
      await tx.aiMessage.deleteMany({ where: { conversation: personal } });
      const purged = await tx.aiConversation.deleteMany({ where: personal });

      await input.audit(tx, { personalAiThreadsDeleted: purged.count });

      return {
        kind: 'unlinked',
        unlinkedAt: input.now,
        sessionsRevoked: revoked.count,
        personalAiThreadsDeleted: purged.count,
      };
    });
  }

  /** The caller's insurance on file: the active policy, else the latest one. */
  insuranceOf(patientId: string): Promise<{
    policyNumber: string;
    plan: string | null;
    validUntil: Date | null;
    isActive: boolean;
    provider: { name: string };
  } | null> {
    return this.prisma.db.patientInsurance.findFirst({
      where: { patientId, deletedAt: null },
      orderBy: [{ isActive: 'desc' }, { updatedAt: 'desc' }],
      select: {
        policyNumber: true,
        plan: true,
        validUntil: true,
        isActive: true,
        provider: { select: { name: true } },
      },
    });
  }
}
