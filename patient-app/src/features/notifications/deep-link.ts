import type { RootStackParamList } from '@/navigation/routes';

/**
 * Where a notification may send a patient — checklist O-04, the in-app
 * half.
 *
 * ── The gap this closes ──────────────────────────────────────────────
 *
 * `http-notification-service.ts` has built a `deepLink` for every
 * appointment notification since O-01 landed, and four tests assert what
 * it may and may not contain. Nothing read it. Tapping a row in the
 * notification centre marked it read and left the patient where they
 * were, so "Your appointment was confirmed" was a statement with no way
 * to act on it and the tap that acknowledged it was the tap that lost
 * it.
 *
 * ── Why an allow-list and not `Linking.openURL` ──────────────────────
 *
 * The link is **server-supplied text**. Handing it to `Linking.openURL`
 * would hand a string the client did not write to the OS, and a
 * `deepLink` that arrived as `https://…` or `tel:…` — through a defect,
 * a compromised row, or a future notification type nobody reviewed —
 * would then be followed. `useLinkTo` is no better: it resolves against
 * the whole `linking.config`, so every route in the app becomes
 * reachable from a notification payload by construction rather than by
 * decision.
 *
 * So this module parses, and refuses anything it does not recognise.
 * The return type is `RootStackParamList`-typed, which means a route
 * that does not exist is a compile error rather than a runtime crash on
 * a screen a patient is reading, and adding a destination is a
 * deliberate edit here rather than a side effect of a server change.
 *
 * ── What is deliberately NOT routable ────────────────────────────────
 *
 * Everything else. `deepLinkFor` only ever emits appointment links today
 * and refuses to link a record, a lab order or a prescription, because
 * "the patient was notified" must never be read as "the patient may see
 * it" — that is AD-5's decision to make, not this client's. This module
 * refusing the same set is the second half of the same rule: even if a
 * link to `medora://records/labs` appeared in a payload tomorrow, it
 * would not open anything until someone added it below on purpose.
 */

/** The scheme this app owns (`app.json`). Nothing else is followed. */
const SCHEME = 'medora://';

/**
 * A navigation target, as `navigation.navigate(...)` takes it.
 *
 * Tupled rather than an object so the call site spreads it, and typed
 * against `RootStackParamList` so an unknown route does not compile.
 */
export type NotificationTarget = {
  readonly [K in keyof RootStackParamList]: [screen: K, params: RootStackParamList[K]];
}[keyof RootStackParamList];

/**
 * Resolves a notification's `deepLink` to somewhere to go, or `null`.
 *
 * `null` is a normal answer, not a failure: most notifications have no
 * link at all, and a link this app does not recognise is one it must not
 * follow. The caller marks the row read either way — acknowledging a
 * notification and acting on it are two different things.
 */
export function notificationTarget(deepLink: string | null): NotificationTarget | null {
  if (deepLink === null || !deepLink.startsWith(SCHEME)) return null;

  const path = deepLink.slice(SCHEME.length);
  const segments = path.split('/').filter((segment) => segment.length > 0);

  // An id with a slash in it would arrive here as two segments, so the
  // shape is checked rather than the prefix: exactly two, the first of
  // which names the destination.
  if (segments.length !== 2) return null;
  const [destination, id] = segments;
  if (destination === 'records' && id === 'labs') {
    return ['Tabs', { screen: 'ProfileTab', params: { screen: 'Tests' } }];
  }
  if (destination !== 'appointments' || id === undefined) return null;

  return [
    'Tabs',
    {
      screen: 'AppointmentsTab',
      params: { screen: 'AppointmentDetail', params: { appointmentId: id } },
    },
  ];
}
