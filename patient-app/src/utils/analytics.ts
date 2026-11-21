import { logger } from '@/utils/logger';

/**
 * Analytics (checklist W-05).
 *
 * ── The rule this file exists to make unbreakable ────────────────────
 * **Event names only. No PHI. No free text.** Not as a convention a
 * reviewer has to catch, but as a shape the code cannot express: every
 * event and every property value it may carry is *enumerated below*, and
 * `track()` validates against that same declaration at runtime. There is
 * no parameter anywhere in this module that accepts an arbitrary string.
 *
 * The failure being designed out is specific and it is the usual one. An
 * analytics call is a one-liner added in a hurry — `track('search',
 * { query })`, `track('booking_failed', { message: error.detail })` —
 * and both of those send a patient's words to a third party. A
 * type-and-data allow-list makes them not compile, and then not run.
 *
 * ── Why it is a *data* allow-list and not only a type ────────────────
 * The types below are derived from `ANALYTICS_EVENTS`, so the compiler
 * rejects an undeclared event or an undeclared value. But typing alone
 * stops at the module boundary: a value arriving from a service, a
 * navigation payload or a `JSON.parse` is `any` often enough that the
 * compiler's guarantee is not the one to rely on for a disclosure. The
 * same declaration is therefore checked at emit, and an unrecognised
 * value is **dropped, not sent**.
 *
 * ── Screens are an allow-list too, and a short one ───────────────────
 * A screen name is not neutral in a health application: *which screens
 * this patient opens* is an inference about their health, which is the
 * reason `features/doctors/recent.ts` keeps recently-viewed doctors in
 * memory rather than on disk. `TRACKED_SCREENS` therefore lists the
 * navigational surfaces only, and `analytics.test.ts` fails if a
 * clinical route is added to it. Records, lab results, prescriptions,
 * documents and message threads are deliberately absent.
 *
 * ── No provider, for the same reason W-04 has none ───────────────────
 * There is no analytics vendor and no identifier of any kind in an
 * event — no user id, no device id, no session id. Nothing is
 * attributable to a patient, which is what makes the counts safe to
 * hold. With no sink registered `track()` drops the event; it does not
 * queue it for a destination that does not exist.
 */

/**
 * The screens whose views are counted.
 *
 * Reviewed, and short on purpose. Adding a route here is a decision
 * about what the operator may learn about a patient, not a
 * configuration change — see the header, and the test that guards it.
 */
export const TRACKED_SCREENS = [
  'Onboarding',
  'Welcome',
  'Login',
  'Register',
  'ForgotPassword',
  'Emergency',
  'HomeRoot',
  'DiscoverRoot',
  'AppointmentsRoot',
  'ProfileRoot',
  'Preferences',
  'Security',
  'Support',
] as const;

/**
 * The complete event catalogue.
 *
 * Each event maps property names to the **exhaustive set of values that
 * property may take**. An empty object means the event carries nothing
 * but its own name, which is the default and the preferred shape.
 */
export const ANALYTICS_EVENTS = {
  /** The process started. Counts installs that actually run. */
  'app.launched': {},
  /**
   * A screen was shown. The only event carrying a name of any kind, and
   * the name comes from `TRACKED_SCREENS`.
   */
  'screen.viewed': { screen: TRACKED_SCREENS },
  /**
   * The forced-upgrade gate replaced the app (W-06). Worth counting
   * because a gate that fires on more builds than intended is the
   * failure that mechanism can cause.
   */
  'upgrade.gate_shown': {},
  /**
   * The two-step dial reached its second step. **Never the number** —
   * an emergency number is operator configuration, and which one a
   * patient chose is a fact about their situation.
   */
  'emergency.call_confirmed': {},
  /** The confirmation sheet was dismissed without dialling. */
  'emergency.call_dismissed': {},
} as const satisfies Record<string, Record<string, readonly (string | number | boolean)[]>>;

export type AnalyticsEventName = keyof typeof ANALYTICS_EVENTS;

/** The properties an event accepts, as literal unions drawn from above. */
export type AnalyticsProps<E extends AnalyticsEventName> = {
  readonly [
    K in keyof (typeof ANALYTICS_EVENTS)[E]
  ]: (typeof ANALYTICS_EVENTS)[E][K] extends readonly (infer V)[] ? V : never;
};

export interface AnalyticsEvent {
  readonly name: AnalyticsEventName;
  readonly props: Readonly<Record<string, string | number | boolean>>;
}

/** Where events go. A provider adapter implements this and nothing else. */
export type AnalyticsSink = (event: AnalyticsEvent) => void;

const sinks = new Set<AnalyticsSink>();

/** Registers a sink. Returns its own removal. */
export function registerAnalyticsSink(sink: AnalyticsSink): () => void {
  sinks.add(sink);
  return () => {
    sinks.delete(sink);
  };
}

/** Test seam. */
export function resetAnalytics(): void {
  sinks.clear();
  lastScreen = null;
}

/**
 * Validates one event against the catalogue.
 *
 * Exported so the tests can assert the rule without a sink, and so a
 * provider adapter has nothing left to check.
 *
 * Returns `null` for anything the catalogue does not describe — an
 * unknown event, an unknown property, or a value outside the declared
 * set. `null` means *dropped*: a partly-valid event is not trimmed and
 * sent, because the property that failed validation is exactly the one
 * that would have been free text.
 */
export function validateEvent(name: string, props: Record<string, unknown>): AnalyticsEvent | null {
  if (!Object.prototype.hasOwnProperty.call(ANALYTICS_EVENTS, name)) return null;

  const allowed = ANALYTICS_EVENTS[name as AnalyticsEventName] as Record<
    string,
    readonly (string | number | boolean)[]
  >;

  const entries = Object.entries(props);
  if (entries.length !== Object.keys(allowed).length) return null;

  for (const [key, value] of entries) {
    const values = allowed[key];
    if (values === undefined) return null;
    if (!values.includes(value as string | number | boolean)) return null;
  }

  return { name: name as AnalyticsEventName, props: props as AnalyticsEvent['props'] };
}

/**
 * Records an event.
 *
 * The overloads are what make a property-less event a call with one
 * argument and a property-carrying event a call with two, without ever
 * admitting an untyped object.
 */
export function track<E extends AnalyticsEventName>(
  ...args: keyof AnalyticsProps<E> extends never ? [event: E] : [event: E, props: AnalyticsProps<E>]
): void {
  const [name, props] = args as [AnalyticsEventName, Record<string, unknown> | undefined];
  const event = validateEvent(name, props ?? {});

  if (event === null) {
    // A developer error, not a patient-facing one: something was called
    // with an event or a value the catalogue does not contain. Logged
    // with the event NAME only — the props are the part that failed
    // validation, so they are the part that must not be logged.
    logger.warn('Analytics event dropped: not in the allow-list', { analyticsEvent: name });
    return;
  }

  for (const sink of sinks) {
    try {
      sink(event);
    } catch {
      // Analytics is the least important thing the app does. It never
      // takes down the screen that emitted it.
    }
  }
}

/**
 * The last screen reported, so a repeat is not counted twice.
 *
 * `onStateChange` fires for every navigation state change, and most of
 * them do not change which screen is visible: a params update, a nested
 * navigator settling, a modal above the tabs closing. Counting those
 * would make "screen views" a measure of navigator churn.
 *
 * Deliberately module state rather than a ref in the caller: the caller
 * is one listener in `App.tsx`, and putting the rule here keeps the
 * whole of "what counts as a view" in one file.
 */
let lastScreen: string | null = null;

/** Test seam, and what a sign-out would call if views were ever scoped. */
export function resetScreenTracking(): void {
  lastScreen = null;
}

/**
 * Records a screen view, given whatever the navigator reported.
 *
 * Takes a plain `string` — a navigator's current route name is not
 * typed as a member of `TRACKED_SCREENS` — and **silently ignores
 * anything outside the list**. Silence is correct here rather than a
 * warning: every clinical route is outside the list on purpose, so a
 * warning would fire on normal use and train people to ignore it.
 *
 * A route outside the list still updates `lastScreen`, so navigating
 * Home → LabResults → Home counts the second Home. The patient did
 * return to it, and the untracked screen in between is untracked, not
 * absent.
 */
export function trackScreenView(routeName: string): void {
  if (routeName === lastScreen) return;
  lastScreen = routeName;
  if (!(TRACKED_SCREENS as readonly string[]).includes(routeName)) return;
  track('screen.viewed', { screen: routeName as (typeof TRACKED_SCREENS)[number] });
}
