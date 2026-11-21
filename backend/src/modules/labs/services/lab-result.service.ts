/**
 * Result entry (RM M14.4 — API §8.6).
 *
 * > "Enter/verify results: snapshots reference ranges, computes flags +
 * > `hasCriticalResult`; timeline `resulted`/`verified`"
 *
 * Three properties, and each is load-bearing.
 *
 * ## The flag is the server's judgement, not a client's claim
 *
 * `enterResultsSchema` has no `flag` field. It cannot: a client that
 * could assert `normal` on a potassium of 7.2 would be asserting that a
 * result nobody needs to see today is fine, and the review discipline of
 * RM M14.5 reads exactly that field to decide whether a checkbox may
 * clear it. So the value arrives as text, `result-grading.ts` grades it
 * against the analyte's own spec, and the flag is written from that.
 *
 * ## The range is snapshotted, not joined
 *
 * `refLow`, `refHigh` and `refText` are copied onto each result row.
 * DB §E5 gives the reason: a reference interval revised next year must
 * not retroactively change whether last year's result was abnormal. The
 * flag is a clinical judgement made at a time, and the row records what
 * it was made against.
 *
 * ## `hasCriticalResult` is read back, never written
 *
 * The M5.10 trigger maintains it. This service asks the repository what
 * the trigger left and raises the critical path from that answer —
 * rather than from its own count of critical flags, which would be a
 * second opinion on a column that already has an authority.
 *
 * ## PD-14.4 — a qualitative result cannot be critical
 *
 * `lab_results_numeric_flag_needs_value` (M5.8) is
 * `flag IN ('normal','abnormal') OR value_numeric IS NOT NULL`, so a
 * result with no numeric value can only be normal or abnormal. The
 * frontend's demo corpus grades some qualitative options `critical-high`
 * by regular expression over the option text; that rule is not
 * transcribed, because the database refuses the row it produces and
 * because "is a positive blood culture a critical result" is a clinical
 * decision, not a pattern match. See `result-grading.ts`. **Needs an
 * owner decision** if qualitative criticals are wanted: it is a column
 * (`critical_options`, say) on `lab_analyte_specs` plus a relaxed CHECK,
 * and both are schema changes.
 */

import { Inject, Injectable } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { AppException } from '../../../common/errors/app.exception';
import { AUDIT_DISPATCHER, type AuditDispatcher } from '../../../shared/audit';
import { OUTBOX, type OutboxPort } from '../../../shared/outbox';
import type { LabOrderDetailView } from '../dto/lab-order.dto';
import type { EnterResultsInput } from '../dto/lab-order.schema';
import { labResultFlagToWire } from '../dto/labs-enums';
import {
  LabResultRepository,
  type AnalyteSpecRow,
  type GradedResult,
} from '../repositories/lab-result.repository';

import { boundsOf } from './lab-test-projection';
import { toLabOrderDetailView } from './lab-order-projection';
import { LabOrderService } from './lab-order.service';
import { assertResultable } from './lab-status.machine';
import {
  flagForNumeric,
  flagForQualitative,
  formatValue,
  isCriticalFlag,
  isOfferedOption,
  isQualitative,
  referenceTextFor,
} from './result-grading';

@Injectable()
export class LabResultService {
  constructor(
    private readonly context: LabOrderService,
    private readonly results: LabResultRepository,
    @Inject(AUDIT_DISPATCHER) private readonly audit: AuditDispatcher,
    @Inject(OUTBOX) private readonly outbox: OutboxPort,
  ) {}

  /** API §8.6. */
  async enter(
    user: AuthenticatedUser,
    publicId: string,
    input: EnterResultsInput,
  ): Promise<LabOrderDetailView> {
    // Resolves the order **and** the care scope — one place, shared with
    // every other route (see `LabOrderService.require`).
    const current = await this.context.require(user, publicId);

    assertResultable(current.status);

    const specs = await this.results.specsForTest(current.test.id);
    const graded = this.gradeAll(input, specs);

    const resultedAt = new Date();
    const { hasCriticalResult } = await this.results.enterResults({
      orderId: current.id,
      results: graded,
      actorId: user.id,
      actorName: await this.context.actorName(user),
      resultedAt,
      detail: summaryDetail(graded),
      // The critical-value alert path this module owns, published
      // **inside** the result transaction (RM M19.1) and **from the
      // trigger's answer**, so an alert cannot be raised for a flag the
      // stored column disagrees with — nor for results that then roll
      // back. M19.2 turns the event into notifications; M30.1 drains the
      // table that carries it.
      emit: async (tx, { hasCriticalResult: critical }) => {
        if (!critical) return;

        await this.outbox.publishWithin(tx, {
          topic: 'lab_result.critical',
          payload: {
            labOrderId: current.publicId,
            patientId: current.patient.publicId,
            test: current.test.code,
            // `OutboxPayload` is scalar-only: "payloads carry
            // identifiers, never clinical content". The analyte *names*
            // are identifiers and the values are not, so the names are
            // joined and the numbers stay behind.
            analytes: graded
              .filter((result) => isCriticalFlag(result.flag))
              .map((result) => result.analyte)
              .join(', '),
          },
          dedupeKey: `lab_result.critical:${current.publicId}:${resultedAt.toISOString()}`,
        });
      },
    });

    await this.audit.record({
      action: 'lab_result.enter',
      actor: { userId: user.id, role: user.role },
      entityType: 'lab_order',
      entityId: current.publicId,
      // Analyte names and flag counts, never the values: a result value
      // is PHI and the row it lives on is already the record. What an
      // audit reader asks is which analytes were touched and whether any
      // of them was critical. `AuditMetadata` is scalar-only by design,
      // so the names are joined rather than nested.
      metadata: {
        analytes: graded.map((result) => result.analyte).join(', '),
        entered: graded.length,
        critical: graded.filter((result) => isCriticalFlag(result.flag)).length,
        hasCriticalResult,
      },
    });

    const row = await this.context.require(user, publicId);

    return toLabOrderDetailView(row, new Date());
  }

  /**
   * Grades every reported value, or refuses the whole batch.
   *
   * **All-or-nothing, before anything is written.** A batch where five
   * of six analytes are recognised is not five results plus a warning:
   * the sixth is a typo or a panel mismatch, and releasing the five
   * would produce a CBC that silently lacks its platelet count. Every
   * problem is collected into one 422 so the entering technician fixes
   * them in one pass rather than one round trip per row.
   */
  private gradeAll(
    input: EnterResultsInput,
    specs: ReadonlyMap<string, AnalyteSpecRow>,
  ): readonly GradedResult[] {
    const fieldErrors: Record<string, string[]> = {};
    const graded: GradedResult[] = [];
    const seen = new Set<string>();

    input.results.forEach((reported, index) => {
      const field = `results.${String(index)}`;
      const spec = specs.get(reported.analyte.toLowerCase());

      if (spec === undefined) {
        fieldErrors[field] = [
          `"${reported.analyte}" is not an analyte of this test. This panel reports: ` +
            `${[...specs.values()].map((row) => row.analyte).join(', ')}.`,
        ];
        return;
      }

      // The catalogue's spelling, so a second batch cannot create a
      // second row for the same analyte under a different case.
      const key = spec.analyte.toLowerCase();
      if (seen.has(key)) {
        fieldErrors[field] = [`"${spec.analyte}" is reported twice in this batch.`];
        return;
      }
      seen.add(key);

      const outcome = this.grade(reported.value, spec);
      if (typeof outcome === 'string') {
        fieldErrors[field] = [outcome];
        return;
      }

      graded.push(outcome);
    });

    if (Object.keys(fieldErrors).length > 0) {
      throw AppException.validation(fieldErrors, 'These results could not be entered');
    }

    return graded;
  }

  /** One value, graded — or the message saying why it could not be. */
  private grade(value: string, spec: AnalyteSpecRow): GradedResult | string {
    const bounds = boundsOf(spec);
    const refText = referenceTextFor(bounds);

    if (isQualitative(bounds)) {
      // An unrecognised qualitative answer is refused rather than filed
      // as abnormal. "Negtive" is a typo, and storing it as an abnormal
      // result would put a patient in a follow-up queue over a keystroke.
      if (!isOfferedOption(value, bounds)) {
        return (
          `"${value}" is not a reported value for ${spec.analyte}. ` +
          `Expected one of: ${bounds.qualitativeOptions.join(', ')}.`
        );
      }

      return {
        analyteSpecId: spec.id,
        analyte: spec.analyte,
        valueText: value,
        // Null by definition, and what the M5.8 CHECK ties to the
        // normal/abnormal-only flag vocabulary.
        valueNumeric: null,
        unit: spec.unit,
        refLow: null,
        refHigh: null,
        refText,
        flag: flagForQualitative(value, bounds),
      };
    }

    const numeric = Number(value);
    if (value.trim() === '' || !Number.isFinite(numeric)) {
      return `${spec.analyte} is a numeric analyte; "${value}" is not a number.`;
    }

    return {
      analyteSpecId: spec.id,
      analyte: spec.analyte,
      // Re-rendered at the analyte's own precision, so "5" and "5.0" are
      // stored identically for a one-decimal analyte and a reader is not
      // invited to infer significance from a technician's keystrokes.
      valueText: formatValue(numeric, bounds.decimals),
      valueNumeric: numeric,
      unit: spec.unit,
      // The snapshot. See the file header.
      refLow: bounds.refLow,
      refHigh: bounds.refHigh,
      refText,
      flag: flagForNumeric(numeric, bounds),
    };
  }
}

/** What the `resulted` timeline entry says, within its 300 characters. */
function summaryDetail(graded: readonly GradedResult[]): string {
  const critical = graded.filter((result) => isCriticalFlag(result.flag));
  const count = `${String(graded.length)} value${graded.length === 1 ? '' : 's'} entered`;

  if (critical.length === 0) return count;

  // The analyte is named and the **number is not**: a timeline is a list
  // of headlines a colleague scans, and the value is one field away in
  // the same payload. Naming the analyte is what makes the entry useful
  // — "critical result" alone tells a reader to go looking.
  return `${count} — critical: ${critical
    .map((result) => `${result.analyte} (${labResultFlagToWire(result.flag)})`)
    .join(', ')}`.slice(0, 300);
}
