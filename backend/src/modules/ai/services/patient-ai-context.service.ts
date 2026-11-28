/**
 * Resolves the personal assistant's context (ADR-050, contract §6).
 *
 * Every turn, from the session: `PatientSelfScopeService` turns the caller
 * into their own `PT-…` handle, and only then are the patient-facing rows
 * read. A thread stores no patient id, so an account unlinked since the
 * thread was opened gets `patient_not_linked` on its next send rather than
 * a stale snapshot.
 *
 * Each read is audited as `patient_ai.context.read` with counts only — the
 * audit log must say that the assistant looked, never what it saw.
 */

import { Inject, Injectable } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { AppException } from '../../../common/errors/app.exception';
import type {
  AppointmentStatus,
  LabSpecimenType,
  LabStatus,
  LabTestCategory,
} from '../../../generated/prisma/enums';
import { AUDIT_DISPATCHER, type AuditDispatcher } from '../../../shared/audit';
import { PatientSelfScopeService, principalOf } from '../../../shared/authz';
import { PatientAiContextRepository } from '../repositories/patient-ai-context.repository';
import type { PatientFacingContext, PatientFacingLabOrder } from './patient-ai-prompt.builder';

/** Contract §4 — the only lab status vocabulary a patient sees. */
export const LAB_STATUS_FOR_PATIENT: Readonly<Record<LabStatus, PatientFacingLabOrder['status']>> =
  {
    ORDERED: 'awaiting_collection',
    COLLECTED: 'in_progress',
    PROCESSING: 'in_progress',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled',
  };

const APPOINTMENT_STATUS_WIRE: Readonly<Record<AppointmentStatus, string>> = {
  SCHEDULED: 'scheduled',
  CONFIRMED: 'confirmed',
  PENDING: 'pending',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  RESCHEDULED: 'rescheduled',
  NO_SHOW: 'no-show',
  AWAITING_PATIENT: 'awaiting-patient',
};

const CATEGORY_WIRE: Readonly<Record<LabTestCategory, string>> = {
  HEMATOLOGY: 'Hematology',
  CHEMISTRY: 'Chemistry',
  MICROBIOLOGY: 'Microbiology',
  IMMUNOLOGY: 'Immunology',
  PATHOLOGY: 'Pathology',
  URINALYSIS: 'Urinalysis',
  HORMONES: 'Hormones',
  BLOOD_BANK: 'Blood Bank',
};

const SPECIMEN_WIRE: Readonly<Record<LabSpecimenType, string>> = {
  SERUM: 'Serum',
  PLASMA: 'Plasma',
  WHOLE_BLOOD: 'Whole blood',
  URINE: 'Urine',
  SWAB: 'Swab',
  TISSUE_BIOPSY: 'Tissue biopsy',
  STOOL: 'Stool',
  SPUTUM: 'Sputum',
  CSF: 'CSF',
};

@Injectable()
export class PatientAiContextService {
  constructor(
    private readonly self: PatientSelfScopeService,
    private readonly repository: PatientAiContextRepository,
    @Inject(AUDIT_DISPATCHER) private readonly audit: AuditDispatcher,
  ) {}

  /** The caller's own handle, or 409 `patient_not_linked`. */
  async requireLinkedPatient(user: AuthenticatedUser): Promise<string> {
    const own = await this.self.patientIdFor(principalOf(user));
    if (own === null) {
      throw AppException.conflict(
        'This account is not linked to a patient record yet',
        'patient_not_linked',
      );
    }

    return own;
  }

  /** Reads, projects and audits the patient-facing layer for one turn. */
  async load(user: AuthenticatedUser, conversationId: string): Promise<PatientFacingContext> {
    const patient = await this.requireLinkedPatient(user);

    const [appointments, labOrders, insurance] = await Promise.all([
      this.repository.appointments(patient),
      this.repository.labOrders(patient),
      this.repository.insurance(patient),
    ]);

    const hospitals = await this.repository.hospitalNames(
      [...appointments, ...labOrders]
        .map((row) => row.hospitalId)
        .filter((id): id is string => id !== null),
    );
    const hospitalName = (id: string | null): string | null =>
      id === null ? null : (hospitals.get(id) ?? null);

    await this.audit.record({
      action: 'patient_ai.context.read',
      actor: { userId: user.id, role: user.role, sessionId: user.sessionId },
      entityType: 'ai_conversation',
      entityId: conversationId,
      metadata: {
        appointments: appointments.length,
        labOrders: labOrders.length,
        insurance: insurance === null ? 0 : 1,
      },
    });

    return {
      readAt: new Date().toISOString(),
      appointments: appointments.map((row) => ({
        id: row.id,
        startsAt: row.startsAt.toISOString(),
        durationMin: row.durationMin,
        status: APPOINTMENT_STATUS_WIRE[row.status as AppointmentStatus] ?? 'unknown',
        visitType: row.visitType,
        department: row.department,
        doctorName: row.doctorName,
        specialty: row.specialty,
        hospital: hospitalName(row.hospitalId),
      })),
      labOrders: labOrders.map((row) => ({
        id: row.id,
        testName: row.testName,
        category: CATEGORY_WIRE[row.category as LabTestCategory] ?? row.category,
        specimenType: SPECIMEN_WIRE[row.specimenType as LabSpecimenType] ?? row.specimenType,
        status: LAB_STATUS_FOR_PATIENT[row.status as LabStatus] ?? 'in_progress',
        requestedAt: row.requestedAt.toISOString(),
        collectedAt: row.collectedAt?.toISOString() ?? null,
        completedAt: row.completedAt?.toISOString() ?? null,
        hospital: hospitalName(row.hospitalId),
      })),
      insurance:
        insurance === null
          ? null
          : {
              providerName: insurance.providerName,
              plan: insurance.plan,
              validUntil: insurance.validUntil?.toISOString().slice(0, 10) ?? null,
              isActive: insurance.isActive,
              updatedAt: insurance.updatedAt.toISOString(),
            },
    };
  }
}
