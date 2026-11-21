/**
 * Result entry (RM M14.4 — API §8.6).
 *
 * ## The whole batch lands in one transaction, and so does its event
 *
 * A panel is entered as a batch because that is how a lab releases one:
 * six analytes come off one analyser run. Writing them one statement at
 * a time outside a transaction would let a reader see a CBC with three
 * of five values and no way to know the rest are coming — and the
 * `resulted` timeline event would then be attached to a partial truth.
 *
 * ## `has_critical_result` is not written here, and must not be
 *
 * The M5.10 trigger `lab_results_refresh_critical_flag` recomputes it
 * from `lab_results` on every insert, update and delete. DB §14.5-6
 * forbids storing derived values and grants this one exception "for
 * index use" — the `lab_orders_critical_unreviewed_idx` partial index
 * the §8.10 chip scans. A stored derivation can be wrong, so nothing
 * writes it by hand: this repository inserts the results and reads the
 * flag back, which is what keeps the exception honest.
 *
 * It follows that the flag is correct **after the transaction commits**,
 * not inside it — the trigger is `AFTER … FOR EACH ROW`, so it has run
 * by the time the enclosing statement returns, and the re-read at the
 * end of the transaction sees it.
 *
 * ## The critical-value event is written here too (RM M19.1)
 *
 * `emit` runs inside this transaction, after the flag has been read
 * back. That is what makes the alert atomic with the results: an event
 * published after commit can survive a rollback of the very results it
 * announces, and a clinician would then be paged about a value no chart
 * holds.
 */

import { Injectable } from '@nestjs/common';

import type { Prisma } from '../../../generated/prisma/client';
import type { LabResultFlag } from '../../../generated/prisma/enums';
import { PrismaService } from '../../../shared/database';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One graded result, ready to store.
 *
 * `refLow`, `refHigh` and `refText` are the **snapshot**: the interval
 * this value was judged against, copied onto the row rather than left to
 * a join. DB §E5 is explicit about why — "a range revised next year must
 * not retroactively change whether last year's result was flagged
 * abnormal" — and `analyte_spec_id` is SET NULL precisely so the row
 * survives the catalogue entry being removed.
 */
export interface GradedResult {
  readonly analyteSpecId: string | null;
  readonly analyte: string;
  readonly valueText: string;
  readonly valueNumeric: number | null;
  readonly unit: string;
  readonly refLow: number | null;
  readonly refHigh: number | null;
  readonly refText: string;
  readonly flag: LabResultFlag;
}

@Injectable()
export class LabResultRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * API §8.6 — write a batch of results and the `resulted` event.
   *
   * Each analyte is upserted on `(lab_order_id, analyte)`, the unique
   * key DB §E5 declares. That makes re-entry of a corrected value an
   * update rather than a second row claiming the same analyte — two
   * potassiums on one order is a reading nobody can resolve. The
   * `resultedAt` is refreshed with the value, because the corrected
   * number was reported now.
   *
   * Returns the order's `has_critical_result` **as the trigger left it**,
   * read back inside the transaction after the writes. The caller uses
   * it to decide whether to raise the critical path, rather than
   * recomputing the same question from its own copy of the flags — one
   * answer, from the row everything else reads.
   */
  async enterResults(input: {
    readonly orderId: string;
    readonly results: readonly GradedResult[];
    readonly actorId: string;
    readonly actorName: string;
    readonly resultedAt: Date;
    readonly detail: string;
    /**
     * Runs inside this transaction, once the critical flag is known
     * (RM M19.1).
     *
     * The caller supplies a function rather than the repository knowing
     * what to emit: `shared/outbox` is the service's dependency, not
     * this file's, and a repository that published its own events would
     * be deciding a thing the module boundary gives to the service.
     * What the repository owns is the *transaction*, so lending it is
     * the smallest thing that makes the event atomic with the results.
     */
    readonly emit?: (
      tx: Prisma.TransactionClient,
      context: { readonly hasCriticalResult: boolean },
    ) => Promise<void>;
  }): Promise<{ readonly hasCriticalResult: boolean }> {
    return this.prisma.$transaction(async (tx) => {
      for (const result of input.results) {
        const data = {
          ...(result.analyteSpecId === null ? {} : { analyteSpecId: result.analyteSpecId }),
          valueText: result.valueText,
          valueNumeric: result.valueNumeric,
          unit: result.unit,
          refLow: result.refLow,
          refHigh: result.refHigh,
          refText: result.refText,
          flag: result.flag,
          resultedAt: input.resultedAt,
          // A corrected value has not been verified by whoever verified
          // the previous one, so the attribution is cleared and the
          // `completed` transition re-stamps it.
          verifiedBy: null,
          deletedAt: null,
        } satisfies Prisma.LabResultUncheckedUpdateInput;

        await tx.labResult.upsert({
          where: {
            labOrderId_analyte: { labOrderId: input.orderId, analyte: result.analyte },
          },
          create: { labOrderId: input.orderId, analyte: result.analyte, ...data },
          update: data,
        });
      }

      await tx.labTimelineEvent.create({
        data: {
          labOrderId: input.orderId,
          kind: 'RESULTED',
          ...(UUID.test(input.actorId) ? { actorId: input.actorId } : {}),
          actor: input.actorName,
          detail: input.detail,
        },
      });

      // Read back rather than computed: the trigger is the authority on
      // this column, and asking it is the only way to know the stored
      // value and the results agree.
      const order = await tx.labOrder.findUniqueOrThrow({
        where: { id: input.orderId },
        select: { hasCriticalResult: true },
      });

      // Inside the transaction, deliberately. A critical-value alert
      // published after commit can outlive a rollback of the results it
      // announces; published here it cannot.
      if (input.emit !== undefined) {
        await input.emit(tx, { hasCriticalResult: order.hasCriticalResult });
      }

      return { hasCriticalResult: order.hasCriticalResult };
    });
  }

  /**
   * The analyte specs for a test, by lower-cased analyte name.
   *
   * Keyed case-insensitively because the analyte arrives as text a
   * technician typed or an instrument exported, and "Hemoglobin" and
   * "hemoglobin" are the same analyte. The stored `analyte` is always
   * the **catalogue's** spelling, taken from the spec rather than from
   * the request, so one panel cannot end up with two spellings of one
   * name across two entry batches — which would defeat the unique key
   * and split the trend series.
   */
  async specsForTest(testId: string): Promise<ReadonlyMap<string, AnalyteSpecRow>> {
    const rows = await this.prisma.db.labAnalyteSpec.findMany({
      where: { testId },
      select: {
        id: true,
        analyte: true,
        unit: true,
        refLow: true,
        refHigh: true,
        decimals: true,
        criticalLow: true,
        criticalHigh: true,
        qualitativeOptions: true,
      },
    });

    return new Map(rows.map((row) => [row.analyte.toLowerCase(), row]));
  }
}

export type AnalyteSpecRow = Prisma.LabAnalyteSpecGetPayload<{
  select: {
    id: true;
    analyte: true;
    unit: true;
    refLow: true;
    refHigh: true;
    decimals: true;
    criticalLow: true;
    criticalHigh: true;
    qualitativeOptions: true;
  };
}>;
