/**
 * Server-authoritative context binding (RM M16.3, API §11.4).
 *
 * > "Client sends only `{ mode, patientId?, refId? }`; server resolves
 * > the bound entities **through `PatientScopeService`**; partial or
 * > failed resolution ⇒ **409, no generation** (fail closed); one
 * > patient maximum per conversation."
 *
 * ## Fail closed means the refusal happens before anything is written
 *
 * Every refusal below throws out of `resolve()`, which the caller runs
 * *before* creating the conversation and *before* reaching the gateway.
 * So a context that cannot be resolved produces no thread, no message
 * row and no provider call — "no generation" in the strongest sense
 * available, which is that nothing happened at all.
 *
 * The ordering of the checks matters and is deliberate:
 *
 * 1. **Shape** — does the mode have the ids it needs? A `patient` mode
 *    with no `patientId` is a malformed request (422): the client can
 *    fix it, and telling it so is not a disclosure.
 * 2. **Scope** — may this doctor reach this patient at all? Answered by
 *    `PatientScopeService`, which refuses with **404**, not 403 — a 403
 *    confirms the patient exists, and walking `PT-1000`, `PT-1001`, …
 *    against a 403/404 split would disclose the roster without opening a
 *    chart (ADR-022).
 * 3. **Resolution** — does the named entity exist, and does it belong to
 *    *that* patient? A deleted `MR-…`, or one belonging to someone else,
 *    is **409**: the request was well formed and permitted, and the
 *    binding still could not be made.
 *
 * Collapsing 2 into 3 would be the security bug. If an unreachable
 * patient answered 409 "could not resolve" while a reachable one with a
 * bad `refId` answered the same, the two would be indistinguishable —
 * but step 2 must be indistinguishable from *a patient who does not
 * exist*, which is a different equivalence. `assertCanReach` gets that
 * right already; this service's job is not to undo it.
 *
 * ## One patient maximum, enforced where it can actually be enforced
 *
 * UX §2.5's rule is that "AI never has cross-patient context in a single
 * thread". Two mechanisms hold it, neither of them a check at send time:
 *
 * · **The context is not patchable.** `updateConversationSchema` accepts
 *   title and favourite only, so there is no route through which a
 *   thread's patient could be moved.
 * · **A second patient is a 422 at creation**, when the mode says
 *   `general` and a `patientId` is supplied anyway — a body asking for a
 *   thread bound to nothing *and* to someone.
 *
 * The database is the backstop: DB §H1's CHECK requires `patient_id` for
 * every mode except `general`, so a row that contradicted this service
 * could not be written even if this service were wrong.
 */

import { Injectable } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { AppException } from '../../../common/errors/app.exception';
import { PatientScopeService, principalOf } from '../../../shared/authz';
import { PATIENT_BOUND_MODES, REF_BOUND_MODES } from '../dto/ai-enums';
import type { AiContextInput } from '../dto/ai.schema';
import {
  AiContextRepository,
  type BoundEntity,
  type BoundPatient,
} from '../repositories/ai-context.repository';

export interface ResolvedContext {
  readonly mode: string;
  readonly patient: BoundPatient | null;
  readonly entity: BoundEntity | null;
  /**
   * Where the patient was reached (F-01, F-06): the doctor's hospital and
   * the patient's record there. A thread bound to a patient is stamped with
   * it, and the bound entity must belong to that hospital.
   */
  readonly chart?: { readonly hospitalId: string; readonly hospitalMedicalRecordId: string };
}

@Injectable()
export class AiContextService {
  constructor(
    private readonly context: AiContextRepository,
    private readonly scope: PatientScopeService,
  ) {}

  /** Resolves, or refuses. Never returns a partially bound context. */
  async resolve(user: AuthenticatedUser, input: AiContextInput): Promise<ResolvedContext> {
    this.assertShape(input);

    if (input.patientId === undefined) {
      // `general` — nothing to bind, nothing to scope.
      return { mode: input.mode, patient: null, entity: null };
    }

    // Step 2. Refuses with 404 and a message identical to a genuinely
    // missing patient's, which is ADR-022's requirement rather than this
    // service's choice.
    const reach = await this.scope.reachAt(principalOf(user), input.patientId);
    const chart = {
      hospitalId: reach.hospitalId,
      hospitalMedicalRecordId: reach.hospitalMedicalRecordId,
    };

    const patient = await this.context.patientByPublicId(input.patientId);
    if (patient === null) throw AppException.notFound('Patient not found');

    if (input.refId === undefined) {
      return { mode: input.mode, patient, entity: null, chart };
    }

    const entity = await this.resolveEntity(input.mode, patient.id, reach.hospitalId, input.refId);

    // Step 3. Well formed, permitted, and still unresolvable — which is
    // the case §11.4 assigns 409 to. The message names the handle
    // because the caller supplied it and already knows it; it names
    // nothing about the patient.
    if (entity === null) {
      throw AppException.conflict(
        `The ${input.mode} context could not be resolved: ${input.refId} is not available on this patient.`,
        'context_unresolved',
        'Context unavailable',
      );
    }

    // The chart travels with the entity too (AI-02): a reference-bound
    // thread is still a thread about this patient at this hospital, and is
    // stamped with both — the `ai_conversations` insert policy refuses one
    // that is not, and on an owner connection it would be unattributed PHI.
    return { mode: input.mode, patient, entity, chart };
  }

  /**
   * Re-resolves the context a stored thread was created with.
   *
   * Called before **every** generation, not only at creation, and that
   * is the fail-closed rule applied over time rather than at a moment: a
   * record deleted, or a patient whose care assignment was revoked,
   * after the thread was opened must stop the next answer. A thread that
   * kept answering about a chart its author no longer has access to
   * would be an authorization check that expired silently.
   */
  async reresolve(
    user: AuthenticatedUser,
    stored: {
      readonly mode: string;
      readonly patientPublicId: string | null;
      readonly refId: string | null;
    },
  ): Promise<ResolvedContext> {
    return this.resolve(user, {
      mode: stored.mode,
      ...(stored.patientPublicId === null ? {} : { patientId: stored.patientPublicId }),
      ...(stored.refId === null ? {} : { refId: stored.refId }),
    });
  }

  /**
   * Step 1 — the cross-field rules the Zod schema deliberately omits.
   *
   * 422 here rather than 409: a body whose mode and ids disagree is
   * malformed, and the client can fix it from the message. See the
   * schema's own note on why the two codes must not be collapsed.
   */
  private assertShape(input: AiContextInput): void {
    const needsPatient = PATIENT_BOUND_MODES.includes(input.mode);

    if (needsPatient && input.patientId === undefined) {
      throw AppException.validation(
        { patientId: [`\`${input.mode}\` mode requires a patient.`] },
        'A patient is required for this context',
      );
    }

    // The other direction, and it is the "one patient maximum" rule's
    // creation-time half: a `general` thread carrying a patient is a
    // request to bind nothing and someone at once.
    if (!needsPatient && input.patientId !== undefined) {
      throw AppException.validation(
        { patientId: ['`general` mode binds no patient.'] },
        'This context binds no patient',
      );
    }

    if (REF_BOUND_MODES.includes(input.mode) && input.refId === undefined) {
      throw AppException.validation(
        { refId: [`\`${input.mode}\` mode requires the entity it is grounded in.`] },
        'A reference is required for this context',
      );
    }

    // A `refId` in a mode that binds no entity would be stored and
    // echoed back on the thread's context, where it would read as a
    // grounding claim nothing supports.
    if (!REF_BOUND_MODES.includes(input.mode) && input.refId !== undefined) {
      throw AppException.validation(
        { refId: [`\`${input.mode}\` mode binds no entity.`] },
        'This context binds no entity',
      );
    }
  }

  private resolveEntity(
    mode: string,
    patientId: string,
    hospitalId: string,
    refId: string,
  ): Promise<BoundEntity | null> {
    switch (mode) {
      case 'record':
        return this.context.recordFor(patientId, hospitalId, refId);
      case 'labs':
        return this.context.labOrderFor(patientId, hospitalId, refId);
      case 'pharmacy':
        return this.context.prescriptionFor(patientId, hospitalId, refId);
      default:
        // Unreachable: `assertShape` has already refused a `refId` in
        // any other mode. Returning null rather than throwing keeps the
        // failure fail-closed if that ever stops being true.
        return Promise.resolve(null);
    }
  }
}
