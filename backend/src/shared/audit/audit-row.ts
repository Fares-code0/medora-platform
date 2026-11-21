import { isIP } from 'node:net';

import type { Prisma } from '../../generated/prisma/client';
import type {
  AuditCategory as PrismaCategory,
  AuditSeverity as PrismaSeverity,
} from '../../generated/prisma/enums';

import { classify, type AuditCategory, type AuditSeverity } from './audit-taxonomy';
import type { AuditEvent } from './audit.types';

/**
 * Wire spelling → Prisma member, in both directions, as ADR-023 §2
 * requires of every enum on this boundary.
 *
 * A `Record` keyed by the wire union rather than a `toUpperCase()`: the
 * cheap trick works for these five today and stops working the moment a
 * value needs a hyphen, which half the enums in this schema already do.
 */
const CATEGORY_TO_PRISMA: Readonly<Record<AuditCategory, PrismaCategory>> = {
  authentication: 'AUTHENTICATION',
  security: 'SECURITY',
  user_action: 'USER_ACTION',
  admin_activity: 'ADMIN_ACTIVITY',
  system: 'SYSTEM',
};

const SEVERITY_TO_PRISMA: Readonly<Record<AuditSeverity, PrismaSeverity>> = {
  info: 'INFO',
  warning: 'WARNING',
  critical: 'CRITICAL',
};

/**
 * The `audit_events` row for one event (RM M28.1).
 *
 * One function, so the best-effort writer and the transactional one file
 * a given event identically. Two copies of this mapping would be two
 * ledgers that an investigator's filter reads differently.
 */
export function auditRowOf(event: AuditEvent): Prisma.AuditEventCreateInput {
  const { category, severity, summary } = classify(event.action);
  const ipAddress = addressOf(event.actor.ipAddress);

  return {
    occurredAt: event.occurredAt ?? new Date(),
    ...(event.actor.userId === null ? {} : { actorId: event.actor.userId }),
    ...(event.actor.role === null ? {} : { actorRole: event.actor.role }),
    category: CATEGORY_TO_PRISMA[category],
    eventType: event.action.slice(0, 60),
    severity: SEVERITY_TO_PRISMA[severity],
    summary,
    // `<entity>:<id>` in one column, which is what the browser's
    // target chip shows and what a pivot groups by.
    target: `${event.entityType}:${event.entityId}`.slice(0, 120),
    // `inet` refuses anything that is not an address, and a refused
    // insert is a lost audit row. A proxy header can hold
    // `unknown`, a comma-separated chain, or a port.
    ...(ipAddress === null ? {} : { ipAddress }),
    ...(event.actor.sessionId === undefined ? {} : { sessionId: event.actor.sessionId }),
    payload: {
      // The correlation id has no column of its own and belongs
      // with the event: it is what ties this row to the request's
      // log lines (API §0.1).
      ...(event.correlationId === undefined ? {} : { correlationId: event.correlationId }),
      ...(event.metadata ?? {}),
    },
  };
}

/** A single IP, or `null` when the value is not one. */
function addressOf(value: string | undefined): string | null {
  if (value === undefined) return null;

  // `X-Forwarded-For` is a chain; the first entry is the client.
  const first = value.split(',')[0]?.trim() ?? '';
  // An IPv6 address in a URL comes bracketed, and `::1` is not `[::1]`.
  const unbracketed = first.replace(/^\[|]$/g, '');

  return isIP(unbracketed) === 0 ? null : unbracketed;
}
