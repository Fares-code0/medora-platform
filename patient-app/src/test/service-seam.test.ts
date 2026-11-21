import fs from 'node:fs';
import path from 'node:path';

import { httpAppointmentService } from '@/features/appointments/http-appointment-service';
import { httpAuthService } from '@/features/auth/http-auth-service';
import { httpDoctorService } from '@/features/doctors/http-doctor-service';
import { httpNotificationService } from '@/features/notifications/http-notification-service';
import { httpProfileService } from '@/features/profile/http-profile-service';

/**
 * **The production adapter implements the whole port** — audit §12,
 * brief §11, §29.
 *
 * ── The failure this exists for ──────────────────────────────────────
 *
 * `api/seam.ts` is the promise that a feature built over fixtures fails
 * *loudly* in production rather than serving a patient invented data.
 * There are two ways to break that promise and nothing was checking
 * either.
 *
 * **A method the production adapter does not have.** Add one to a port,
 * implement it in the fixture, forget the `http` side: in development
 * everything works, and in a release build the call is
 * `undefined is not a function` — a crash where the design promised an
 * `EndpointNotImplementedError` naming the blocker. For
 * `unavailableService` that is a forgotten string in an array, which no
 * type catches because the parameter is `readonly (keyof T)[]` and a
 * *subset* satisfies it. For a hand-written adapter it is a missing
 * property, which no type catches either once the object is asserted to
 * the port. Both are one-line omissions on a normal day's work: this
 * file added `listAnnouncements` to `ClinicService` and would have been
 * the thing that noticed if the array had not been updated with it.
 *
 * **A fixture in the `http` slot.** The one mistake that would put
 * invented clinical data on a patient's phone, and the seam's whole
 * reason for existing. `docs-consistency.test.ts` checks the ARCHITECTURE
 * table against the source, but a fixture passed as `http` would simply
 * be *documented* as a fixture and both would agree.
 *
 * ── Static for the names, runtime for the implementation ─────────────
 *
 * A port is a TypeScript interface and is gone by the time the tests
 * run, so the method names are read from the source. What is done with
 * them differs: a feature that passes a real adapter has it imported and
 * inspected — `typeof adapter[method] === 'function'` — and a feature
 * behind `unavailableService` has its array compared to the interface,
 * which is the same question one step earlier.
 */

const FEATURES = path.resolve(__dirname, '..', 'features');

/**
 * Adapters that are neither `unavailableService` nor named `http…`, with
 * the decision that allows each. Emergency passes a frozen
 * `UNCONFIGURED_EMERGENCY` — numbers a clinic has not configured are
 * absent rather than guessed (N-04), which is a *value*, not a fixture.
 */
const ALLOWED_CUSTOM_ADAPTERS: Record<string, string> = {
  emergency: 'unconfigured',
};

/** The production adapters that are real objects, by feature. */
const IMPLEMENTATIONS: Record<string, object> = {
  appointments: httpAppointmentService,
  auth: httpAuthService,
  doctors: httpDoctorService,
  notifications: httpNotificationService,
  profile: httpProfileService,
};

interface Seam {
  readonly feature: string;
  readonly adapter: string;
  readonly port: string;
  /** Method names declared on the port interface. */
  readonly portMethods: readonly string[];
  /** Method names listed in the `unavailableService` call, if any. */
  readonly listedMethods: readonly string[] | null;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
}

/** The method names declared on `export interface <name>`, in any file. */
function portMethodsOf(featureDir: string, port: string): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) files.push(full);
    }
  };
  walk(featureDir);

  for (const file of files) {
    const body = new RegExp(`export interface ${port}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(
      fs.readFileSync(file, 'utf8'),
    )?.[1];
    if (body === undefined) continue;
    return [...stripComments(body).matchAll(/^ {2}(\w+)\s*\(/gm)].map((m) => m[1] ?? '');
  }
  throw new Error(`Port interface ${port} was not found under ${featureDir}.`);
}

function readSeams(): Seam[] {
  return fs
    .readdirSync(FEATURES)
    .filter((feature) => fs.existsSync(path.join(FEATURES, feature, 'service.ts')))
    .sort()
    .map((feature) => {
      const source = fs.readFileSync(path.join(FEATURES, feature, 'service.ts'), 'utf8');
      const selection = /selectService\(\{([\s\S]*?)\n\}\)/.exec(source)?.[1] ?? '';
      const adapter = /http:\s*([A-Za-z_$][\w$]*)/.exec(selection)?.[1];
      if (adapter === undefined) throw new Error(`No http adapter in ${feature}/service.ts`);

      // The port is named either by the unavailable helper's type
      // argument or by the annotation on the binding `selectService`
      // returns — which is `export const x: XService = …` in nine
      // features and a plain `const selected: AuthService = …` in auth,
      // where a development-only wrapper sits between the selection and
      // the export.
      const port =
        /unavailableService<(\w+)>/.exec(selection)?.[1] ??
        /(?:export )?const \w+:\s*(\w+)\s*=\s*selectService/.exec(source)?.[1];
      if (port === undefined) throw new Error(`No port type named in ${feature}/service.ts`);

      const listed =
        adapter === 'unavailableService'
          ? [
              ...(/unavailableService<[^>]+>\([\s\S]*?\[([\s\S]*?)\]/
                .exec(selection)?.[1]
                ?.matchAll(/'([^']+)'/g) ?? []),
            ].map((m) => m[1] ?? '')
          : null;

      return {
        feature,
        adapter,
        port,
        portMethods: portMethodsOf(path.join(FEATURES, feature), port),
        listedMethods: listed,
      };
    });
}

const SEAMS = readSeams();

describe('no feature can serve a patient invented data', () => {
  it('finds a seam in every feature that has one, so nothing is skipped silently', () => {
    // A guard that quietly inspects nothing is worse than none: this is
    // the assertion that the scan above actually found the features.
    expect(SEAMS.map((seam) => seam.feature)).toEqual([
      'appointments',
      'auth',
      'clinic',
      'doctors',
      'emergency',
      'health',
      'home',
      'messages',
      'notifications',
      'profile',
    ]);
  });

  it.each(SEAMS)('$feature passes no fixture as its production adapter', (seam) => {
    const allowed =
      seam.adapter === 'unavailableService' ||
      /^http[A-Z]/.test(seam.adapter) ||
      ALLOWED_CUSTOM_ADAPTERS[seam.feature] === seam.adapter;

    expect({ feature: seam.feature, adapter: seam.adapter, allowed }).toEqual({
      feature: seam.feature,
      adapter: seam.adapter,
      allowed: true,
    });
  });

  it('declares at least one method on every port, so an empty scan cannot pass', () => {
    for (const seam of SEAMS) {
      expect(seam.portMethods.length).toBeGreaterThan(0);
    }
  });
});

describe('every port method exists on the production adapter', () => {
  const refusing = SEAMS.filter((seam) => seam.listedMethods !== null);

  it.each(refusing)('$feature refuses by name, for all of $port', (seam) => {
    // A method left out of the array is `undefined` on the production
    // adapter: a `TypeError` where the seam promised an
    // `EndpointNotImplementedError` naming the blocker. The type cannot
    // catch it — `readonly (keyof T)[]` is satisfied by a subset.
    expect([...(seam.listedMethods ?? [])].sort()).toEqual([...seam.portMethods].sort());
  });

  const implemented = SEAMS.filter((seam) => IMPLEMENTATIONS[seam.feature] !== undefined);

  it.each(implemented)('$feature implements all of $port', (seam) => {
    const adapter = IMPLEMENTATIONS[seam.feature] as Record<string, unknown>;
    const missing = seam.portMethods.filter((method) => typeof adapter[method] !== 'function');

    expect(missing).toEqual([]);
  });

  it('inspects every feature exactly once, by one route or the other', () => {
    // Neither list may quietly shrink: a feature that stopped being
    // refused and never gained an entry in `IMPLEMENTATIONS` would drop
    // out of both checks above without failing either.
    const covered = new Set([...refusing, ...implemented].map((seam) => seam.feature));
    const uncovered = SEAMS.filter((seam) => !covered.has(seam.feature)).map((s) => s.feature);

    // `emergency` is the one deliberate gap: its production adapter is a
    // frozen value rather than a module, and `UNCONFIGURED_EMERGENCY` is
    // typed as the port, so the compiler already holds the whole of it.
    expect(uncovered).toEqual(['emergency']);
  });
});
