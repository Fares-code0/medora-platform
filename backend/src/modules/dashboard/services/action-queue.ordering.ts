/**
 * "Sorted by urgency then age" (RM M15.4 — UX §2.1), as a pure function.
 *
 * Split out of the service and unit-tested because it is the only part
 * of the widget with a rule in it. Everything else is four queries and a
 * projection; this is the sentence the product actually wrote down, and
 * a sort that is nearly right — stable in the wrong dimension, or
 * tie-broken by whichever query returned first — produces a queue that
 * looks plausible and puts the wrong thing at the top.
 *
 * ## The three rules
 *
 * **Urgency first, and it is a rank, not a number.** `critical` before
 * `high` before `normal`, full stop: an unreviewed critical result does
 * not fall below an appointment request because the request is older.
 * UX §2.1 also puts that source in the Row 0 banner, which is the same
 * judgement said twice.
 *
 * **Then age, oldest first.** "Age" is how long the row has been
 * waiting, so the oldest is the most overdue. This is the direction it
 * is easy to get backwards — every other list in this application is
 * newest-first — and it is the reason this file has a test.
 *
 * **Then a stable tie-break on the handle.** Two rows created in the
 * same millisecond must not swap places between two requests: the widget
 * polls, and a queue that reshuffles under a doctor's cursor is one they
 * stop trusting. `Array.prototype.sort` is stable in modern V8, but the
 * *input* order here is four concatenated queries — so stability alone
 * would only preserve an order that is itself arbitrary.
 */

import type { ActionQueueItemView, ActionQueueUrgency } from '../dto/action-queue.dto';

/** Lower sorts first. */
const URGENCY_RANK: Record<ActionQueueUrgency, number> = {
  critical: 0,
  high: 1,
  normal: 2,
};

export function compareQueueItems(a: ActionQueueItemView, b: ActionQueueItemView): number {
  const byUrgency = URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency];
  if (byUrgency !== 0) return byUrgency;

  // Oldest first — see rule 2. Compared as strings because both are
  // ISO-8601 in UTC, where lexical and chronological order coincide,
  // and `Date.parse` on every comparison would be work for nothing.
  const byAge = a.waitingSince.localeCompare(b.waitingSince);
  if (byAge !== 0) return byAge;

  return a.id.localeCompare(b.id);
}

/** Sorts a copy; the caller's array is not reordered underneath it. */
export function orderQueue(
  items: readonly ActionQueueItemView[],
): readonly ActionQueueItemView[] {
  return [...items].sort(compareQueueItems);
}

/**
 * Whole hours a row has been waiting, floored and never negative.
 *
 * Floored because "waiting 3 hours" must not become 4 at three hours and
 * one minute — a client rendering "3h" beside a server saying 4 is a
 * disagreement a reader notices. Clamped at zero because a row whose
 * `waitingSince` is in the future (a scheduled appointment's request
 * created by a clock a few milliseconds ahead) has not waited a negative
 * length of time.
 */
export function ageHoursBetween(waitingSince: Date, now: Date): number {
  const elapsed = now.getTime() - waitingSince.getTime();

  return elapsed <= 0 ? 0 : Math.floor(elapsed / (60 * 60 * 1000));
}
