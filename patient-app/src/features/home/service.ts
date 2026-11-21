import { selectService, unavailableService } from '@/api/seam';

import type { ActivityEvent, ActivityService } from './model/types';

/**
 * Recent activity.
 *
 * ── The module landed, and it carries a DIFFERENT feed ───────────────
 *
 * This used to say the feed belonged to the users module (**BE-10**, M8)
 * and was not built. M8 is built, `/me/sessions` came with it, and
 * `GET /me/activity` exists — so the sentence needs replacing rather
 * than deleting, because the route it names is **not this one**.
 *
 * `shared/activity/activity.types.ts` is explicit: `user_activity_log`
 * is what a user sees *about their own account* in Settings → Activity,
 * and its vocabulary is the seven kinds `profile · password · login ·
 * settings · security · integration · privacy`. The vocabulary below is
 * clinical — an appointment confirmed, a result available, a message
 * received. Pointing this section at that route would render "password
 * changed" where "your result is ready" belongs: not a near-miss, a
 * different product.
 *
 * So the feed this section needs is still unbuilt, and the blocker is
 * now an absent route rather than an absent module.
 *
 * The other tempting substitute is to build the feed on this phone out
 * of what the client can already read — the appointment list and the
 * notification feed are both live. That is refused, for two reasons:
 *
 * 1. It would be **wrong**, quietly. A client-side feed shows the events
 *    that happen to be in two caches, so "recent activity" would mean
 *    "recent activity Medora had already downloaded" — and it would go
 *    empty on a fresh install, which reads as "nothing has happened to
 *    you" rather than as "this list has not loaded".
 * 2. It would duplicate the notification centre while claiming to be
 *    something else. Two lists derived from one source that disagree
 *    after a `markRead` is a bug report nobody can reproduce.
 *
 * So the fixture holds a plausible feed for development and the HTTP
 * adapter refuses by name. `RecentActivity` renders **nothing at all**
 * when it refuses, rather than an error card on the app's front page —
 * the component explains why.
 */

function hoursAgo(hours: number): string {
  const date = new Date();
  date.setHours(date.getHours() - hours);
  return date.toISOString();
}

const FIXTURE_EVENTS: readonly ActivityEvent[] = [
  { id: 'AC-1', kind: 'appointment-confirmed', occurredAt: hoursAgo(3), appointmentId: 'APT-2001' },
  { id: 'AC-2', kind: 'result-available', occurredAt: hoursAgo(26), appointmentId: null },
  { id: 'AC-3', kind: 'message-received', occurredAt: hoursAgo(50), appointmentId: null },
  { id: 'AC-4', kind: 'appointment-booked', occurredAt: hoursAgo(72), appointmentId: 'APT-2001' },
];

const fixtureActivityService: ActivityService = {
  async listRecentActivity() {
    return FIXTURE_EVENTS;
  },
};

export const activityService: ActivityService = selectService({
  fixture: fixtureActivityService,
  http: unavailableService<ActivityService>('BE-10', 'capability.recentActivity', ['listRecentActivity']),
});
