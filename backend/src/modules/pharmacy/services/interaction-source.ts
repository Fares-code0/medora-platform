/**
 * The drug-interaction source, behind a port (RM M13.2, M13.3).
 *
 * ## Why this is a port and the allergy query is not
 *
 * API §7.7 has exactly one dependency whose failure is given its own
 * status code: "safety source down ⇒ 409 `safety_check_unavailable`
 * (**draft-only, fail closed**)". A port is what makes that branch
 * reachable in a test without breaking the database — RM M13.3's verify
 * step demands a "chaos test with the interaction source disabled", and
 * the only honest way to disable it is to substitute an implementation
 * that fails, exactly as `createAuthHarness` substitutes the mailer.
 *
 * Patient allergies are not behind a port because they are not a
 * *source* — they are this system's own record of the patient, read from
 * the same database and the same transaction as the write. If that read
 * fails, the request has already failed.
 *
 * ## It is also the seam ADR-010 §8 anticipated
 *
 * The table is the v1 answer; a licensed interaction service is the
 * eventual one. Writing the screen against this interface now means that
 * swap is a provider binding rather than a rewrite of the one module
 * where a mistake prescribes the wrong drug.
 *
 * ## Failure is an exception here, deliberately
 *
 * The pure screen is total and cannot report "I could not check". This
 * port can, and it does so by throwing: a caller that ignores a returned
 * error value still runs the write it was guarding, whereas one that
 * ignores an exception does not exist. `PrescriptionService` catches it
 * at exactly one place and turns it into the 409.
 */

import { Injectable } from '@nestjs/common';

import type { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../shared/database';
import { warningSeverityToWire } from '../dto/pharmacy-enums';

/**
 * A Prisma client that may be a transaction's. The raw client, for the
 * reason `safety.repository.ts` records.
 */
export type Db = Prisma.TransactionClient;

export interface InteractionRow {
  readonly medicationAId: string;
  readonly medicationBId: string;
  /** `info | warning | critical`, wire form. */
  readonly severity: string;
  readonly title: string;
  readonly detail: string;
  readonly management: string | null;
}

export interface InteractionSource {
  /**
   * Interaction rows pairing `medicationId` with any of `partnerIds`.
   *
   * **Throws** when the source cannot answer. An empty array means
   * "checked, nothing found" and must never be used to mean "could not
   * check" — conflating the two is what fail-closed exists to prevent.
   */
  interactionsBetween(
    medicationId: string,
    partnerIds: readonly string[],
    tx?: Db,
  ): Promise<readonly InteractionRow[]>;
}

export const INTERACTION_SOURCE = Symbol('INTERACTION_SOURCE');

/** Raised when the source cannot answer. Never when it answers "none". */
export class InteractionSourceUnavailable extends Error {
  constructor(cause?: unknown) {
    super('The drug-interaction source is unavailable');
    this.name = 'InteractionSourceUnavailable';
    this.cause = cause;
  }
}

/**
 * The v1 implementation — ADR-010 group 8's `drug_interactions` table.
 *
 * The pair is stored **once**, ordered, under a CHECK forcing
 * `medication_a_id < medication_b_id` (DB §F9): storing both directions
 * would let the two rows disagree about severity, and for an interaction
 * check that is the worst possible failure — the answer would depend on
 * which drug the caller happened to name first. The cost is here: a
 * query against one column only would miss every interaction whose uuid
 * sorted the other way, so both directions are asked for.
 */
@Injectable()
export class PrismaInteractionSource implements InteractionSource {
  constructor(private readonly prisma: PrismaService) {}

  async interactionsBetween(
    medicationId: string,
    partnerIds: readonly string[],
    tx?: Db,
  ): Promise<readonly InteractionRow[]> {
    if (partnerIds.length === 0) return [];

    try {
      const rows = await (tx ?? this.prisma).drugInteraction.findMany({
        where: {
          active: true,
          OR: [
            { medicationAId: medicationId, medicationBId: { in: [...partnerIds] } },
            { medicationBId: medicationId, medicationAId: { in: [...partnerIds] } },
          ],
        },
        select: {
          medicationAId: true,
          medicationBId: true,
          severity: true,
          title: true,
          detail: true,
          management: true,
        },
      });

      return rows.map((row) => ({
        medicationAId: row.medicationAId,
        medicationBId: row.medicationBId,
        // Prisma hands back the **member** (`WARNING`), and this port
        // speaks wire values (`warning`). Translating here rather than
        // letting the member through is not cosmetic: the consumer's
        // fail-closed fallback grades anything it cannot recognise as
        // `critical`, so an untranslated member would silently report
        // every interaction — info ones included — as critical, and the
        // grading RM M13.2 asks for would quietly not exist.
        severity: warningSeverityToWire(row.severity),
        title: row.title,
        detail: row.detail,
        management: row.management,
      }));
    } catch (error) {
      // A database error here is indistinguishable, from the caller's
      // point of view, from a licensed service being down — and both
      // must fail closed rather than resolve to "no interactions".
      throw new InteractionSourceUnavailable(error);
    }
  }
}
