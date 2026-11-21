import fs from 'node:fs';
import path from 'node:path';

import {
  ANALYTICS_EVENTS,
  registerAnalyticsSink,
  resetAnalytics,
  track,
  trackScreenView,
  TRACKED_SCREENS,
  validateEvent,
  type AnalyticsEvent,
} from '@/utils/analytics';

/**
 * W-05 — analytics: event names only, no PHI, no free text.
 *
 * The compiler already refuses an undeclared event or an undeclared
 * value, and a test cannot assert on code that does not compile. What
 * these tests cover is the half the compiler cannot: a value that
 * arrives at runtime from somewhere untyped, and the *content* of the
 * allow-list itself, which is a review decision rather than a type.
 */

const SRC = path.join(__dirname, '..');

let warned: jest.SpyInstance;

beforeEach(() => {
  resetAnalytics();
  // Held as a handle rather than asserted through `console.warn`: a
  // member expression on `console` is a lint error in this tree, and the
  // rule is worth more than the shorter assertion.
  warned = jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  resetAnalytics();
  jest.restoreAllMocks();
});

function collect(): AnalyticsEvent[] {
  const events: AnalyticsEvent[] = [];
  registerAnalyticsSink((event) => events.push(event));
  return events;
}

describe('the catalogue admits no free text', () => {
  it('declares every property as an exhaustive set of values', () => {
    for (const [name, props] of Object.entries(ANALYTICS_EVENTS)) {
      for (const [key, values] of Object.entries(props)) {
        expect(Array.isArray(values)).toBe(true);
        expect(`${name}.${key}`).toBeTruthy();
        expect((values as readonly unknown[]).length).toBeGreaterThan(0);
      }
    }
  });

  it('drops a value that is not in the declared set', () => {
    // The shape of the leak this guards: a free-text search term, a
    // server `detail`, a message body — arriving through an untyped
    // path that the compiler never saw.
    expect(validateEvent('screen.viewed', { screen: 'I have chest pain' })).toBeNull();
    expect(validateEvent('screen.viewed', { screen: 'HealthRecords' })).toBeNull();
  });

  it('drops an event that is not in the catalogue', () => {
    expect(validateEvent('search.performed', { query: 'cardiologist' })).toBeNull();
  });

  it('drops an extra property rather than trimming it away', () => {
    // Trimming would send a valid-looking event and hide the fact that
    // somebody tried to attach something. The property that failed
    // validation is the one most likely to be the free text.
    expect(validateEvent('screen.viewed', { screen: 'Login', email: 'a@b.com' })).toBeNull();
    expect(validateEvent('app.launched', { userId: 'PT-4417' })).toBeNull();
  });

  it('drops an event that is missing a declared property', () => {
    expect(validateEvent('screen.viewed', {})).toBeNull();
  });

  it('does not accept an inherited property name as a known event', () => {
    expect(validateEvent('constructor', {})).toBeNull();
    expect(validateEvent('toString', {})).toBeNull();
  });

  it('accepts what the catalogue does describe', () => {
    expect(validateEvent('app.launched', {})).toEqual({ name: 'app.launched', props: {} });
    expect(validateEvent('screen.viewed', { screen: 'Login' })).toEqual({
      name: 'screen.viewed',
      props: { screen: 'Login' },
    });
  });
});

describe('the screen allow-list is a review decision', () => {
  /** Clinical surfaces. Which of these a patient opens is an inference. */
  const CLINICAL_ROUTES = [
    'HealthRecords',
    'LabResults',
    'Prescriptions',
    'Documents',
    'AppointmentDetail',
    'DoctorProfile',
    'Thread',
    'MessagesRoot',
    'Booking',
    'Notifications',
    'EditProfile',
  ];

  it.each(CLINICAL_ROUTES)('does not track %s', (route) => {
    expect(TRACKED_SCREENS as readonly string[]).not.toContain(route);
  });

  it('names only routes that exist', () => {
    const routes = fs.readFileSync(path.join(SRC, 'navigation', 'routes.ts'), 'utf8');
    for (const screen of TRACKED_SCREENS) {
      expect(routes).toContain(`${screen}:`);
    }
  });

  it('ignores a route outside the list without complaining', () => {
    const events = collect();
    trackScreenView('LabResults');
    trackScreenView('Thread');
    expect(events).toEqual([]);
    // Silence, not a warning: every clinical route is outside the list
    // on purpose, so a warning would fire on normal use.
    expect(warned).not.toHaveBeenCalled();
  });

  it('records a route inside the list', () => {
    const events = collect();
    trackScreenView('Welcome');
    expect(events).toEqual([{ name: 'screen.viewed', props: { screen: 'Welcome' } }]);
  });

  it('does not count the same screen twice in a row', () => {
    // `onStateChange` fires for every navigation state change, and most
    // do not change which screen is visible — a params update, a nested
    // navigator settling, a modal closing. Counting those would make
    // "screen views" a measure of navigator churn.
    const events = collect();
    trackScreenView('Welcome');
    trackScreenView('Welcome');
    trackScreenView('Welcome');
    expect(events).toHaveLength(1);
  });

  it('counts a return to a screen after being somewhere else', () => {
    const events = collect();
    trackScreenView('HomeRoot');
    trackScreenView('DiscoverRoot');
    trackScreenView('HomeRoot');
    expect(events.map((event) => event.props['screen'])).toEqual([
      'HomeRoot',
      'DiscoverRoot',
      'HomeRoot',
    ]);
  });

  it('counts a return through an untracked screen', () => {
    // Home → LabResults → Home is two views of Home. The clinical screen
    // in between is untracked, not absent.
    const events = collect();
    trackScreenView('HomeRoot');
    trackScreenView('LabResults');
    trackScreenView('HomeRoot');
    expect(events).toHaveLength(2);
  });
});

describe('delivery', () => {
  it('hands every sink the same event', () => {
    const first = collect();
    const second = collect();
    track('app.launched');
    expect(first).toEqual([{ name: 'app.launched', props: {} }]);
    expect(second).toEqual(first);
  });

  it('is a no-op with no sink registered', () => {
    expect(() => track('app.launched')).not.toThrow();
  });

  it('survives a sink that throws', () => {
    registerAnalyticsSink(() => {
      throw new Error('the analytics service is down');
    });
    const events = collect();
    expect(() => track('emergency.call_confirmed')).not.toThrow();
    expect(events).toHaveLength(1);
  });

  it('stops delivering to a removed sink', () => {
    const events: AnalyticsEvent[] = [];
    const remove = registerAnalyticsSink((event) => events.push(event));
    remove();
    track('app.launched');
    expect(events).toEqual([]);
  });

  it('warns with the event name only when it drops one', () => {
    // The props are what failed validation, so the props are what must
    // not reach the log either.
    (track as unknown as (n: string, p: Record<string, unknown>) => void)('search.performed', {
      query: 'chest pain',
    });
    expect(warned).toHaveBeenCalledWith('[medora] Analytics event dropped: not in the allow-list', {
      analyticsEvent: 'search.performed',
    });
  });
});

describe('nothing identifies a patient', () => {
  it('declares no property that could carry an identifier', () => {
    const FORBIDDEN = ['userid', 'patientid', 'deviceid', 'sessionid', 'email', 'phone', 'name'];
    for (const props of Object.values(ANALYTICS_EVENTS)) {
      for (const key of Object.keys(props)) {
        const normalised = key.toLowerCase().replace(/[^a-z]/g, '');
        for (const forbidden of FORBIDDEN) {
          expect(normalised).not.toContain(forbidden);
        }
      }
    }
  });

  it('is only ever called with a literal event name', () => {
    // A computed name would step around the compile-time half of the
    // allow-list, leaving only `validateEvent` between a variable and a
    // sink. Asserted across the tree because it is a rule about call
    // sites, not about this module.
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) continue;
        if (full.endsWith(path.join('utils', 'analytics.ts'))) continue;
        const source = fs.readFileSync(full, 'utf8');
        for (const match of source.matchAll(/\btrack\(([^)]*)/g)) {
          const first = (match[1] ?? '').trim();
          if (!first.startsWith("'") && !first.startsWith('"')) {
            offenders.push(`${path.relative(SRC, full)}: track(${first}`);
          }
        }
      }
    };
    walk(SRC);
    expect(offenders).toEqual([]);
  });
});
