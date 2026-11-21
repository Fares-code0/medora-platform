import { CalendarClock, FlaskConical, ShieldAlert, type LucideIcon } from 'lucide-react';

import { formatDateTime } from '@/i18n';
import { routes } from '@/routes';

import { waitedFor } from './elapsed';

/**
 * The Overview's Row-0 critical alerts (UX §2.1, API §16.3, RM M27.3),
 * shared by the demo and the HTTP adapter so the two cannot draw the same
 * server fact two ways — the arrangement `pulse.ts` uses for the M27.2
 * widgets.
 *
 * UX §2.1 names three sources, and so does the server: a critical lab
 * result nobody has reviewed, an active critical alert on a patient the
 * doctor sees today (where an allergy conflict is recorded), and an urgent
 * appointment that was moved. Each alert gets one resolving action.
 */

export const CRITICAL_ALERT_KINDS = [
  'unreviewed-critical-lab',
  'allergy-conflict',
  'urgent-reschedule',
] as const;
export type CriticalAlertKind = (typeof CRITICAL_ALERT_KINDS)[number];

export interface CriticalAlert {
  readonly id: string;
  readonly kind: CriticalAlertKind;
  readonly patientName: string;
  /** The one-line summary, in the server's words. */
  readonly message: string;
  /** When it matters, worded for its kind; `null` where the instant means nothing. */
  readonly detail: string | null;
  /** Always a route of this app — see `alertHref`. */
  readonly href: string;
}

/**
 * What the banner was told. `served: false` is an API that has no such
 * route (one built from `main`): nothing was checked, so nothing is said.
 * A failure is neither — the port rejects, and the banner says it could
 * not check.
 */
export type CriticalAlertsAnswer =
  { readonly served: true; readonly alerts: readonly CriticalAlert[] } | { readonly served: false };

interface KindPresentation {
  readonly icon: LucideIcon;
  /** The resolving action's visible text. */
  readonly action: string;
  /** Where the action goes when the server's path is not one this app knows. */
  readonly fallback: string;
  /** The server's path shapes this kind may link to, each mapped to a route. */
  readonly accepts: readonly ((path: string) => string | null)[];
}

const ID_SEGMENT = '([A-Za-z0-9_-]+)';

function routeFor(pattern: string, build: (id: string) => string) {
  const shape = new RegExp(`^${pattern.replace(':id', ID_SEGMENT)}$`);
  return (path: string) => {
    const id = shape.exec(path)?.[1];
    return id === undefined ? null : build(id);
  };
}

function exactly(path: string, route: string) {
  return (candidate: string) => (candidate === path ? route : null);
}

export const CRITICAL_ALERT_PRESENTATION: Readonly<Record<CriticalAlertKind, KindPresentation>> = {
  'unreviewed-critical-lab': {
    icon: FlaskConical,
    action: 'Review result',
    fallback: routes.doctor.labs,
    accepts: [routeFor('/doctor/labs/:id', routes.doctor.labReport)],
  },
  'allergy-conflict': {
    icon: ShieldAlert,
    // The server links the conflict to the day's book, not to a chart: the
    // alert row it reads names the patient but sends no patient id. Only
    // that shape is followed, so the action's words stay true.
    action: "Open today's appointments",
    fallback: routes.doctor.appointments,
    accepts: [exactly('/doctor/appointments', routes.doctor.appointments)],
  },
  'urgent-reschedule': {
    icon: CalendarClock,
    action: 'View appointment',
    fallback: routes.doctor.appointments,
    accepts: [routeFor('/doctor/appointments/:id', routes.doctor.appointment)],
  },
};

/**
 * The link for an alert, from the server's `path`. Only a shape this kind
 * is known to use is followed, rebuilt from this app's own route table;
 * anything else — another kind's page, an absolute URL, a path the client
 * has no route for — falls back to the kind's list. The fallback is the
 * point: a path the client cannot follow must not cost the doctor the
 * alert, and a body the server did not mean must not send them elsewhere.
 */
export function alertHref(kind: CriticalAlertKind, path: string): string {
  const presentation = CRITICAL_ALERT_PRESENTATION[kind];
  for (const accept of presentation.accepts) {
    const href = accept(path);
    if (href !== null) return href;
  }
  return presentation.fallback;
}

/**
 * The server's `since` is a different instant per kind: when the lab was
 * ordered, when the moved appointment now starts (ahead, by construction),
 * and for a conflict only the moment the answer was generated. So each is
 * worded for what it is, and the last is not shown.
 */
export function alertDetail(
  kind: CriticalAlertKind,
  since: string,
  now = Date.now(),
): string | null {
  switch (kind) {
    case 'unreviewed-critical-lab':
      return `Ordered ${waitedFor(since, now)}`;
    case 'urgent-reschedule':
      return `Now ${formatDateTime(since)}`;
    case 'allergy-conflict':
      return null;
  }
}
