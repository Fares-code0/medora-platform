import { formatDateWith } from '@/i18n';
/**
 * An audited, expiring, justified grant — the mechanism behind every gated
 * reveal in the admin area.
 *
 * Extracted from ADM-10's PHI gate so ADM-06's content access reuses it
 * rather than reimplementing it: two implementations of the thing that
 * protects patient privacy means a hardening fix can reach one and miss the
 * other.
 *
 * Nothing here knows what is being revealed. The category type, the window
 * and the minimum reason length are all the consumer's to choose, because
 * they are policy — and policy belongs where the policy is decided.
 *
 * `grantFor` takes four consecutive string parameters (`subjectId`,
 * `subjectLabel`, `category`, `reason`), with the generic `C` inferred from
 * whatever lands in position 3. Transposing label and category at a direct
 * call site still type-checks — TypeScript just infers `C = string`.
 * Consumers should bind the generic explicitly by wrapping `grantFor` in
 * their own typed function (see `admin/phi/phi-access.ts`'s `grantFor`,
 * which fixes `C = PhiJustificationCategory`) rather than calling this one
 * directly.
 */

/** One live elevation, scoped to a single record. */
export interface AccessGrant<C extends string> {
  readonly subjectId: string;
  readonly subjectLabel: string;
  readonly category: C;
  readonly reason: string;
  readonly grantedAt: number;
  readonly expiresAt: number;
}

export function grantFor<C extends string>(
  subjectId: string,
  subjectLabel: string,
  category: C,
  reason: string,
  now: number,
  minutes: number,
): AccessGrant<C> {
  return {
    subjectId,
    subjectLabel,
    category,
    reason: reason.trim(),
    grantedAt: now,
    expiresAt: now + minutes * 60_000,
  };
}

export function isLive(grant: AccessGrant<string>, now: number): boolean {
  return grant.expiresAt > now;
}

/**
 * Drops expired grants. Returns the same array when nothing expired, so a
 * caller can skip a re-render.
 */
export function pruneGrants<C extends string>(
  grants: readonly AccessGrant<C>[],
  now: number,
): readonly AccessGrant<C>[] {
  const live = grants.filter((grant) => isLive(grant, now));
  return live.length === grants.length ? grants : live;
}

export interface ReasonValidation {
  readonly ok: boolean;
  readonly message?: string;
}

export function validateReason(reason: string, minLength: number): ReasonValidation {
  const trimmed = reason.trim();
  if (trimmed.length === 0) return { ok: false, message: 'A written reason is required.' };
  if (trimmed.length < minLength) {
    return {
      ok: false,
      message: `Give at least ${String(minLength)} characters — this is read by whoever audits the access.`,
    };
  }
  return { ok: true };
}

/** `14:32` — when a live grant re-masks itself. */
export function formatExpiry(grant: AccessGrant<string>): string {
  return formatDateWith(new Date(grant.expiresAt), {
    hour: '2-digit',
    minute: '2-digit',
  });
}
