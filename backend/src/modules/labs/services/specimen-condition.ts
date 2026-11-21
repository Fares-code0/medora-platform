/**
 * The specimen gate (RM M14.3 — API §8.5).
 *
 * > "specimen condition ∈ {Hemolyzed, Clotted, Insufficient volume}
 * > blocks `processing` (409)"
 *
 * One rule, and it is a clinical one rather than a validation nicety.
 * A hemolyzed sample releases potassium out of the red cells it broke,
 * so a hemolyzed potassium reads high — sometimes critically high — for
 * a patient whose potassium is fine. A clotted EDTA tube has consumed
 * the platelets it is being counted for. An under-filled citrate tube
 * has the wrong anticoagulant ratio and prolongs every clotting time.
 * In each case the analyser produces a number, the number is wrong in a
 * clinically plausible direction, and nothing downstream can tell. The
 * only safe answer is to refuse the run and redraw.
 *
 * ## Why this is not in the status machine
 *
 * `lab-status.machine.ts` decides which statuses may follow which. This
 * decides whether a specific specimen may be run at all, and the two
 * failures need different codes: `invalid_status_transition` tells a
 * client its request was out of order, `specimen_unusable` tells a lab
 * to redraw. Folding the second into the first would answer a clotted
 * sample with a message about allowed statuses.
 *
 * ## Why the set is derived, not retyped
 *
 * `BLOCKING_CONDITIONS` is every member of `LabSpecimenCondition` except
 * `ACCEPTABLE`. Spelling the three out would be a second list to keep in
 * step with the enum: a fifth condition added to DB §E4 — `Lipemic`,
 * say — would silently default to *runnable* under a hand-written set,
 * which is the fail-open direction. Derived, it defaults to blocked, and
 * whoever adds a runnable condition has to say so here.
 */

import { AppException } from '../../../common/errors/app.exception';
import type { LabSpecimenCondition } from '../../../generated/prisma/enums';
import { labSpecimenConditionToWire } from '../dto/labs-enums';

/**
 * The one condition a specimen may be processed in.
 *
 * `Record<LabSpecimenCondition, boolean>` rather than a set literal, so
 * a new member of the enum fails to compile here until someone decides
 * whether it is runnable.
 */
const RUNNABLE: Record<LabSpecimenCondition, boolean> = {
  ACCEPTABLE: true,
  HEMOLYZED: false,
  CLOTTED: false,
  INSUFFICIENT_VOLUME: false,
};

export const BLOCKING_CONDITIONS: readonly LabSpecimenCondition[] = (
  Object.keys(RUNNABLE) as LabSpecimenCondition[]
).filter((condition) => !RUNNABLE[condition]);

export function isRunnable(condition: LabSpecimenCondition): boolean {
  return RUNNABLE[condition];
}

/** Why each blocking condition means the number would be wrong. */
const REASON: Record<LabSpecimenCondition, string> = {
  ACCEPTABLE: '',
  HEMOLYZED:
    'Lysed cells release their contents into the sample, so potassium and LDH read high for ' +
    'a patient whose values are normal.',
  CLOTTED:
    'A clotted sample has consumed the cells and factors it is being measured for, so counts ' +
    'read low.',
  INSUFFICIENT_VOLUME:
    'An under-filled tube has the wrong sample-to-additive ratio, which shifts the result ' +
    'rather than failing to produce one.',
};

/**
 * Refuses `processing` for a specimen that cannot be run.
 *
 * 409 rather than 422: the request is well-formed and the caller is
 * permitted — the specimen is in a state that does not accept the move,
 * which is exactly what API §0.3 gives 409 to, `detail` and all.
 *
 * **A missing specimen is also a refusal.** An order cannot reach
 * `processing` without one: `collected` is the step that captures it,
 * and a lab processing a specimen with no chain of custody is the
 * failure `lab_specimens` exists to make impossible. The caller gets a
 * distinct code so "no specimen" and "bad specimen" are not one error.
 */
export function assertProcessable(condition: LabSpecimenCondition | null): void {
  if (condition === null) {
    throw AppException.conflict(
      'This order has no specimen record, so there is nothing to process. Capture the ' +
        'specimen with the `collected` transition first.',
      'specimen_missing',
      'No specimen',
    );
  }

  if (isRunnable(condition)) return;

  const wire = labSpecimenConditionToWire(condition);

  throw AppException.conflict(
    `${wire} specimens cannot be processed. ${REASON[condition]} Recollect and order again.`,
    'specimen_unusable',
    `Specimen is ${wire.toLowerCase()}`,
  );
}
