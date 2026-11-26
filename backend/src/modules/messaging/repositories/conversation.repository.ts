/**
 * Conversations and their per-viewer state (API §9.1, §9.2, §9.7).
 *
 * ## Membership is the authorization, and it is a join
 *
 * Every query here goes through `conversation_participants` with the
 * caller's `userId` in the predicate. There is no path that loads a
 * thread by id alone, so a later caller cannot forget a check that is
 * not optional — a thread the caller is not in is never loaded rather
 * than loaded and then rejected. `@@id([conversationId, userId])` makes
 * that lookup the primary key.
 *
 * ## Per-viewer state lives on the participant row
 *
 * Unread count, pinned, starred, archived, muted and the draft are the
 * participant's, not the thread's — DB §14.5 says why, and the sharpest
 * case is the draft: on the thread row it would be visible to everyone
 * in it.
 */

import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import type { Prisma } from '../../../generated/prisma/client';
import { BADGE_COUNTS, CacheService } from '../../../shared/cache';
import { DoctorPracticeStatus, DoctorVerificationStatus } from '../../../generated/prisma/enums';
import { PrismaService, runAsSystem } from '../../../shared/database';
import type { ClinicalReach } from '../../../shared/authz';
import type { MessagingFolder } from '../dto/messaging-enums';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ConversationCriteria {
  readonly folder: MessagingFolder;
  readonly q?: string | undefined;
  readonly page: number;
  readonly pageSize: number;
}

const MEMBERSHIP_SELECT = {
  conversationId: true,
  userId: true,
  unreadCount: true,
  lastReadAt: true,
  conversation: {
    select: { id: true, patientId: true, readOnly: true, kind: true, topic: true },
  },
} as const;

const LIST_SELECT = {
  conversationId: true,
  unreadCount: true,
  pinned: true,
  starred: true,
  archived: true,
  muted: true,
  draft: true,
  lastReadAt: true,
  conversation: {
    select: {
      id: true,
      kind: true,
      topic: true,
      patientId: true,
      readOnly: true,
      lastActivityAt: true,
      participants: { select: { userId: true } },
      messages: {
        where: { deletedAt: null },
        orderBy: { sentAt: 'desc' as const },
        take: 1,
        select: { id: true, authorId: true, body: true, sentAt: true, kind: true },
      },
    },
  },
} as const;

/**
 * The six folders, transcribed from `messaging/model/selectors.ts`'s
 * `inFolder`.
 *
 * Five of the six are "not archived, and …" — archiving is the one state
 * that takes a thread out of every other folder, which is what makes it
 * filing rather than another flag.
 *
 * `sent` is the only folder that is not a column: it asks whether the
 * **last** message is the caller's. That cannot be answered by a
 * participant predicate, so it is applied after the page is read — see
 * `list`.
 */
function folderWhere(folder: MessagingFolder, userId: string): Prisma.ConversationParticipantWhereInput {
  switch (folder) {
    case 'unread':
      return { archived: false, unreadCount: { gt: 0 } };
    case 'starred':
      return { archived: false, starred: true };
    case 'drafts':
      return { archived: false, draft: { not: '' } };
    case 'archived':
      return { archived: true };
    case 'sent':
      // Narrowed here to threads the caller has actually written in;
      // "is the last message mine" is decided in the service.
      return { archived: false, conversation: { messages: { some: { authorId: userId } } } };
    case 'inbox':
    default:
      return { archived: false };
  }
}

@Injectable()
export class ConversationRepository {
  constructor(
    private readonly prisma: PrismaService,
    /**
     * Badge invalidation (RM M31.1). `unread_count` and `archived` on
     * `conversation_participants` are half of every participant's badge,
     * so each write here bumps the badges it touched — after the commit.
     */
    private readonly cache: CacheService,
  ) {}

  async list(
    userId: string,
    criteria: ConversationCriteria,
  ): Promise<{ rows: readonly ParticipantRow[]; totalItems: number }> {
    if (!UUID.test(userId)) return { rows: [], totalItems: 0 };

    const where: Prisma.ConversationParticipantWhereInput = {
      userId,
      ...folderWhere(criteria.folder, userId),
      ...(criteria.q === undefined
        ? {}
        : {
            conversation: {
              ...(criteria.folder === 'sent' ? { messages: { some: { authorId: userId } } } : {}),
              OR: [
                { topic: { contains: criteria.q, mode: 'insensitive' } },
                { messages: { some: { body: { contains: criteria.q, mode: 'insensitive' } } } },
              ],
            },
          }),
    };

    const [rows, totalItems] = await Promise.all([
      this.prisma.db.conversationParticipant.findMany({
        where,
        select: LIST_SELECT,
        // Pinned first, then most recently active — the order the thread
        // list renders in, and the index `[lastActivityAt desc]` serves.
        orderBy: [{ pinned: 'desc' }, { conversation: { lastActivityAt: 'desc' } }],
        skip: (criteria.page - 1) * criteria.pageSize,
        take: criteria.pageSize,
      }),
      this.prisma.db.conversationParticipant.count({ where }),
    ]);

    return { rows, totalItems };
  }

  /** The caller's membership row, or null — the authorization check. */
  async membership(userId: string, conversationId: string): Promise<MembershipRow | null> {
    if (!UUID.test(userId) || !UUID.test(conversationId)) return null;

    return this.prisma.db.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
      select: MEMBERSHIP_SELECT,
    });
  }

  /**
   * Creates the thread and every membership in one transaction.
   *
   * A thread that committed without its participants would be invisible
   * to everyone including its author, and recoverable only by an
   * administrator — so the two writes share a commit.
   */
  async create(input: {
    readonly authorId: string;
    readonly participantIds: readonly string[];
    readonly topic?: string | undefined;
    /** The patient the thread is about, where the author reached them (F-06). */
    readonly chart?: ClinicalReach | undefined;
  }): Promise<string> {
    const id = await this.prisma.$transaction(async (tx) => {
      // The id is chosen here and the row inserted without RETURNING (F-04's
      // lesson): the author becomes a participant only in the next
      // statement, so Row-Level Security would not let the new row be
      // read back yet.
      const conversation = { id: randomUUID() };
      await tx.conversation.createMany({
        data: {
          id: conversation.id,
          // A thread with more than two people is a group, and the kind
          // is derived rather than taken from the client: a `direct`
          // thread with five participants is a state no reader expects.
          kind: input.participantIds.length > 1 ? 'GROUP' : 'DIRECT',
          ...(input.topic === undefined ? {} : { topic: input.topic }),
          ...(input.chart === undefined
            ? {}
            : {
                patientId: input.chart.patientId,
                hospitalId: input.chart.hospitalId,
                hospitalMedicalRecordId: input.chart.hospitalMedicalRecordId,
              }),
        },
      });

      await tx.conversationParticipant.createMany({
        data: [input.authorId, ...input.participantIds].map((userId) => ({
          conversationId: conversation.id,
          userId,
        })),
        // The caller may name itself; the set is what matters, not the
        // client's care in building it.
        skipDuplicates: true,
      });

      return conversation.id;
    });

    await this.cache.invalidate(BADGE_COUNTS, [input.authorId, ...input.participantIds]);

    return id;
  }

  /** API §9.7 — one control writes one field, scoped to the viewer. */
  async patchState(
    userId: string,
    conversationId: string,
    patch: Prisma.ConversationParticipantUpdateInput,
  ): Promise<number> {
    if (!UUID.test(userId) || !UUID.test(conversationId)) return 0;

    const result = await this.prisma.db.conversationParticipant.updateMany({
      where: { conversationId, userId },
      data: patch,
    });

    // Archiving a thread drops its unread messages from the badge; the
    // other flags do not move it, but one bump is cheaper than deciding.
    if (result.count > 0) await this.cache.invalidate(BADGE_COUNTS, [userId]);

    return result.count;
  }

  /** Every participant except the sender — the fan-out for unread counts. */
  async otherParticipants(
    conversationId: string,
    exceptUserId: string,
  ): Promise<readonly string[]> {
    const rows = await this.prisma.db.conversationParticipant.findMany({
      where: { conversationId, userId: { not: exceptUserId } },
      select: { userId: true },
    });

    return rows.map((row) => row.userId);
  }

  /**
   * Which of these ids are active accounts with standing at `hospitalId`
   * (API §9.2; checklist F1, AF-16) — the only accounts a thread at that
   * hospital may name:
   *
   * | Role | Standing at the hospital |
   * | --- | --- |
   * | `doctor` | an active employment there, the doctor verified and in clinical practice (the `clinicalEmployment` rule) |
   * | `reception`, `laboratory`, `pharmacy`, `nurse` | an active affiliation there |
   * | `admin` | an active hospital `admin` assignment there (a Platform Admin holds none: the database keeps the two exclusive) |
   *
   * A patient account, an ended employment or affiliation, a revoked
   * assignment and every other hospital's staff match nothing.
   *
   * Read under the request's own tenant context, not `system`: the
   * staffing tables are `org_visible(hospital_id)`, so the caller's own
   * hospital's rows are exactly the ones visible, and `users`, `roles`,
   * `doctors` and `staff_members` carry no policy.
   */
  async usersWithStandingAt(
    ids: readonly string[],
    hospitalId: string,
  ): Promise<readonly string[]> {
    const ACTIVE_HOSPITAL = { status: 'ACTIVE', deletedAt: null } as const;
    const rows = await this.prisma.db.user.findMany({
      where: {
        id: { in: [...ids] },
        status: 'ACTIVE',
        deletedAt: null,
        OR: [
          {
            role: { is: { code: 'doctor' } },
            doctor: {
              is: {
                deletedAt: null,
                verificationStatus: DoctorVerificationStatus.VERIFIED,
                practiceStatus: { in: [...CLINICAL_PRACTICE_STATUSES] },
                employments: {
                  some: { hospitalId, endedAt: null, hospital: { is: ACTIVE_HOSPITAL } },
                },
              },
            },
          },
          {
            role: { is: { code: { in: [...STAFF_ROLE_CODES] } } },
            staffMember: {
              some: {
                deletedAt: null,
                hospitalAffiliations: {
                  some: { hospitalId, endedAt: null, hospital: { is: ACTIVE_HOSPITAL } },
                },
              },
            },
          },
          {
            role: { is: { code: 'admin' } },
            hospitalRoleAssignments: {
              some: {
                hospitalId,
                revokedAt: null,
                role: { is: { code: 'admin' } },
                hospital: { is: ACTIVE_HOSPITAL },
              },
            },
          },
        ],
      },
      select: { id: true },
    });

    return rows.map((row) => row.id);
  }

  /**
   * A staff account's one hospital: its single active affiliation at an
   * ACTIVE hospital, or `null` (none, or several — ambiguous, fail closed).
   * The caller's own staffing, read under `system` scope exactly as
   * `TenantContextResolver` reads it.
   */
  async staffHospitalOf(userId: string): Promise<string | null> {
    // Trusted lookup of the caller's own staffing (the same read the
    // tenant-context resolver makes before any tenant context exists).
    // `async` + `await`: a Prisma query is lazy, so returned un-awaited it
    // would run after `runAsSystem` had returned — under the caller's scope.
    const rows = await runAsSystem(async () =>
      await this.prisma.db.hospitalStaffAffiliation.findMany({
        where: {
          endedAt: null,
          staff: { is: { userId, deletedAt: null } },
          hospital: { is: { status: 'ACTIVE', deletedAt: null } },
        },
        select: { hospitalId: true },
        distinct: ['hospitalId'],
        take: 2,
      }),
    );

    return rows.length === 1 ? (rows[0]?.hospitalId ?? null) : null;
  }
}

/**
 * The practice states that hold clinical standing — the same pair as the
 * authz kernel's `CLINICAL_PRACTICE_STATUSES`, which is not exported through
 * its index (M2.3 forbids importing kernel internals).
 */
const CLINICAL_PRACTICE_STATUSES = [DoctorPracticeStatus.ACTIVE, DoctorPracticeStatus.VACATION] as const;

/** The staff roles whose hospital standing is an affiliation. */
export const STAFF_ROLE_CODES: ReadonlySet<string> = new Set([
  'reception',
  'laboratory',
  'pharmacy',
  'nurse',
]);

export type ParticipantRow = Prisma.ConversationParticipantGetPayload<{
  select: typeof LIST_SELECT;
}>;

export type MembershipRow = Prisma.ConversationParticipantGetPayload<{
  select: typeof MEMBERSHIP_SELECT;
}>;
