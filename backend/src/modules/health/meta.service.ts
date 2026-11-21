/**
 * The server's enum vocabulary — API §20.3, RM M27.5.
 *
 * > ✅ Verify: a contract test diffs `/meta/enums` against the frontend
 * > unions and fails on drift.
 *
 * ## Read out of PostgreSQL, not transcribed
 *
 * Every other vocabulary in this codebase is a transcription held to its
 * source by a parity spec, because the source is in another tree. This
 * one is different: the vocabulary being published **is** the database's,
 * and `pg_enum` holds it. Reading it there means the endpoint cannot
 * drift from the schema, because it is not a copy of the schema.
 *
 * The labels are the `@map` values — `no-show`, `pending-approval`,
 * `in-progress` — which are exactly the spellings that go on the wire
 * (ADR-023 §2). A transcription would have had to keep the hyphens right
 * in a second place.
 *
 * ## `enumsortorder`, not alphabetical
 *
 * The declaration order is meaningful for several of these — a status
 * machine reads top to bottom — and a contract test that diffed a sorted
 * list against a declared union would report a false difference the
 * first time someone inserted a value in the middle.
 *
 * ## What it does not carry
 *
 * The vocabularies closed by `CHECK` rather than by a PostgreSQL enum —
 * `files.kind`, `patient_doctor_assignments.role`,
 * `domain_events.status` — are absent, because they are not enum types
 * and `pg_enum` does not know them. M5's migrations state why each one
 * is a CHECK: §6's enum inventory does not list those vocabularies, so
 * creating a type for them would put something in `pg_type` that no
 * specification describes. A client needing one reads its own contract
 * section; this endpoint reports what the *type system* holds.
 */

import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../shared/database';

export interface MetaEnumsResponse {
  /** Type name → its members, in declaration order. */
  readonly enums: Readonly<Record<string, readonly string[]>>;
}

interface EnumRow {
  readonly type_name: string;
  readonly label: string;
}

@Injectable()
export class MetaService {
  constructor(private readonly prisma: PrismaService) {}

  async enums(): Promise<MetaEnumsResponse> {
    const rows = await this.prisma.$queryRaw<EnumRow[]>`
      SELECT t.typname AS type_name, e.enumlabel AS label
      FROM pg_type t
      JOIN pg_enum e ON e.enumtypid = t.oid
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = current_schema()
      ORDER BY t.typname, e.enumsortorder
    `;

    const enums: Record<string, string[]> = {};

    for (const row of rows) {
      (enums[row.type_name] ??= []).push(row.label);
    }

    return { enums };
  }
}
