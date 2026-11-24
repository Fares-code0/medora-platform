/**
 * The safety screen's wiring (RM M13.2 — API §7.5).
 *
 * Gathers what `safety-screen.ts` needs and hands it over. No clinical
 * rule lives here: this file resolves ids, enforces scope, and translates
 * rows — and the moment a rule appears in two places, the two start
 * disagreeing about whether a prescription is safe.
 *
 * ## Run twice, and the second run is the one that matters
 *
 * `screen()` is called advisorily by `POST /prescriptions/safety-check`
 * and authoritatively by `POST /prescriptions/{id}/sign` **inside the
 * signing transaction** (M13.3). Both go through this method, and the
 * `tx` parameter is what lets the second read the same snapshot the
 * write commits against. A second implementation for the authoritative
 * path is how the advisory answer and the binding one come to differ.
 *
 * ## Scope is enforced here, not in the controller
 *
 * A safety check names a patient and returns their allergies in prose.
 * That is PHI, so `assertCanReach` runs before any of it is read, and a
 * patient outside the caller's care answers 404 identically to one that
 * does not exist (ADR-022).
 */

import { Inject, Injectable } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { AppException } from '../../../common/errors/app.exception';
import { PatientScopeService, principalOf } from '../../../shared/authz';
import { MedicationRepository } from '../repositories/medication.repository';
import { PrescriptionRepository, type Db } from '../repositories/prescription.repository';
import { SafetyRepository } from '../repositories/safety.repository';

import { INTERACTION_SOURCE, type InteractionSource } from './interaction-source';
import {
  screenPrescription,
  type CurrentMedication,
  type InteractionFinding,
  type ScreenResult,
  type ScreenSeverity,
} from './safety-screen';

export interface ScreenRequest {
  /** `PT-…`. */
  readonly patientId: string;
  readonly medicationId: string;
  /**
   * Excluded from the current-medication list, so a prescription being
   * signed is not screened against itself and reported as duplicate
   * therapy with itself.
   */
  readonly excludePrescriptionId?: string | undefined;
}

export interface ScreenOutcome extends ScreenResult {
  /** Resolved here so callers do not look the patient up a second time. */
  readonly patient: { readonly id: string; readonly publicId: string; readonly fullName: string };
  readonly medication: {
    readonly id: string;
    readonly name: string;
    readonly genericName: string;
  };
}

/** The three graded severities, as `drug_interactions.severity` spells them. */
const SEVERITIES: readonly string[] = ['info', 'warning', 'critical'];

@Injectable()
export class SafetyService {
  constructor(
    private readonly prescriptions: PrescriptionRepository,
    private readonly medications: MedicationRepository,
    private readonly safety: SafetyRepository,
    private readonly scope: PatientScopeService,
    @Inject(INTERACTION_SOURCE) private readonly interactions: InteractionSource,
  ) {}

  /**
   * Screen a candidate prescription.
   *
   * Throws `InteractionSourceUnavailable` when the interaction source
   * cannot answer — never a cleared result. The caller decides what that
   * means: §7.5 reports it as a 503-class failure, §7.7 turns it into
   * 409 `safety_check_unavailable` and leaves the prescription in draft.
   */
  async screen(
    user: AuthenticatedUser,
    request: ScreenRequest,
    tx?: Db,
  ): Promise<ScreenOutcome> {
    // The screen reads the active hospital's allergies and prescriptions
    // only (S3, DR-04; #17 isolates rows with no hospital).
    const scope = await this.scope.assertCanReach(principalOf(user), request.patientId);

    const patient = await this.prescriptions.patientByPublicId(request.patientId, tx);
    // Reachable when a care relationship exists for a chart that has
    // since been soft-deleted. Same 404, same wording.
    if (patient === null) throw AppException.notFound('Patient not found');

    const medication = await this.medications.findById(request.medicationId);
    if (medication === null) {
      throw AppException.validation(
        { medicationId: ['Unknown medication'] },
        'Unknown medication',
      );
    }

    const [allergies, current] = await Promise.all([
      this.safety.allergiesFor(patient.id, scope.hospitalId, tx),
      this.safety.currentMedicationsFor(
        patient.id,
        scope.hospitalId,
        { excludePrescriptionId: request.excludePrescriptionId },
        tx,
      ),
    ]);

    const currentMedications: readonly CurrentMedication[] = current.map((row) => ({
      prescriptionId: row.prescriptionId,
      medicationId: row.medicationId,
      name: row.name,
      genericName: row.genericName,
      category: row.category,
      isHighRisk: row.isHighRisk,
    }));

    // Throws on failure. Deliberately not caught here — see the docblock.
    const rows = await this.interactions.interactionsBetween(
      medication.id,
      currentMedications.map((entry) => entry.medicationId),
      tx,
    );

    const findings: readonly InteractionFinding[] = rows.map((row) => ({
      // The pair is stored once, ordered; whichever side is not the
      // candidate is the partner.
      partnerMedicationId:
        row.medicationAId === medication.id ? row.medicationBId : row.medicationAId,
      severity: toSeverity(row.severity),
      title: row.title,
      detail: row.detail,
      management: row.management,
    }));

    const result = screenPrescription({
      patientName: patient.fullName,
      allergies: allergies.map((allergy) => ({
        allergen: allergy.allergen,
        severity: allergy.severity,
      })),
      medicationId: medication.id,
      brandName: medication.name,
      genericName: medication.genericName,
      category: medication.category,
      allergyClass: medication.allergyClass,
      currentMedications,
      interactions: findings,
    });

    return {
      ...result,
      patient,
      medication: {
        id: medication.id,
        name: medication.name,
        genericName: medication.genericName,
      },
    };
  }
}

/**
 * `drug_interactions.severity` is a database enum, so it is already one
 * of three values — but it arrives here typed as `string` because the
 * port deliberately speaks wire values rather than Prisma members. An
 * unrecognised value is treated as `critical` rather than dropped: a
 * severity this code cannot grade is not evidence that the interaction
 * is mild, and under-reporting is the failure that matters here.
 */
function toSeverity(value: string): ScreenSeverity {
  return SEVERITIES.includes(value) ? (value as ScreenSeverity) : 'critical';
}
