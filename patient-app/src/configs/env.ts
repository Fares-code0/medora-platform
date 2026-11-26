import { z } from 'zod';

/**
 * Runtime configuration, validated at boot — the port of
 * `frontend/src/configs/env.ts`.
 *
 * A misconfigured deployment fails here with a readable message rather
 * than failing mysteriously at the first request. On mobile that matters
 * more than on the web: a bad web build is fixed by a redeploy, a bad
 * store build is fixed by a review queue measured in days.
 *
 * **`EXPO_PUBLIC_*` variables are compiled into the bundle** and are
 * readable by anyone who unzips the .apk. No secret, key or credential
 * may ever be one (checklist T-01). There is nothing in the schema below
 * that is not already public — a timeout in minutes is a policy an
 * attacker can measure with a stopwatch anyway.
 */
/**
 * The schemes a store link may use.
 *
 * `Linking.openURL` opens whatever it is given, and `z.string().url()`
 * accepts `javascript:` and any deep link along with it. The same guard
 * `features/emergency/dial.ts` puts in front of a dialled number belongs
 * in front of this one, and more so: it is the only button on a screen
 * the patient cannot navigate away from, so a misconfiguration there is
 * not recoverable by going somewhere else in the app.
 *
 * `market:` (Android) and `itms-apps:` (iOS) open the store app directly
 * and are the reason this is an allow-list rather than "https only".
 */
const STORE_URL_SCHEMES = ['https:', 'market:', 'itms-apps:'];

function isStoreUrl(value: string): boolean {
  try {
    return STORE_URL_SCHEMES.includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * ── The API base URL must be `https:` outside development (T-14) ─────
 *
 * `z.string().url()` accepts `http://api.medora.example/api/v1` exactly
 * as readily as the `https:` one, and until 2026-09-14 that is what the
 * schema asked for. Every request this client makes carries a bearer
 * token in an `Authorization` header and returns a patient's chart in
 * the body, so a production build pointed at an `http:` origin publishes
 * both to every hop between the phone and the server — hotel Wi-Fi, a
 * hostile access point, an ISP transparent proxy. It is not a
 * hypothetical misconfiguration either: the shipped DEFAULT is
 * `http://localhost:3000/api/v1`, so an operator who forgets the
 * variable entirely gets cleartext rather than a failure, and a `.env`
 * copied from a developer's machine carries the scheme with it.
 *
 * `z.string().url()` is also wider than "a web address": `javascript:`,
 * `file:` and `data:` all parse. The base URL is concatenated into every
 * `fetch`, so the scheme allow-list below is the same guard `dial.ts`
 * puts in front of a `tel:` and `isStoreUrl` puts in front of the
 * upgrade link, applied to the one URL that sees PHI.
 *
 * ── Why `http:` survives at all ─────────────────────────────────────
 *
 * A development build talks to a server on the developer's own machine,
 * which has no certificate and should not need one. Forbidding `http:`
 * outright would mean either a self-signed certificate in every
 * checkout or a schema nobody can satisfy locally — and a rule that
 * cannot be followed gets switched off.
 *
 * So the exception is scoped twice over, and both halves must hold:
 *
 * 1. `EXPO_PUBLIC_APP_ENV` is `development`. Staging carries real
 *    accounts and real-shaped data; it is not a laxer production.
 * 2. The host is one that cannot leave the developer's own network —
 *    loopback, an RFC-1918 private range, link-local, or `10.0.2.2`,
 *    which is how the Android emulator reaches its host machine.
 *
 * `http://api.medora.example` is therefore rejected even in a
 * development build: a public hostname over cleartext is the mistake
 * this rule exists to catch, whichever flavour the build claims to be.
 */
const API_URL_SCHEMES = ['https:', 'http:'];

/**
 * Hosts an `http:` origin may name in development.
 *
 * Matched against `URL.hostname`, which strips the port and, for IPv6,
 * keeps the brackets — hence the two spellings of `::1`.
 */
function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase();

  // `localhost`, and the `*.localhost` names RFC 6761 reserves for it.
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  // IPv6 loopback, with and without the brackets `URL` adds.
  if (host === '::1' || host === '[::1]') return true;

  const octets = host.split('.');
  if (octets.length !== 4) return false;
  if (octets.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return false;
  const a = Number(octets[0]);
  const b = Number(octets[1]);

  if (a === 127) return true; // 127.0.0.0/8  — loopback
  if (a === 10) return true; // 10.0.0.0/8   — private, and the emulator's 10.0.2.2
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 — private
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12  — private
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 — link-local
  return false;
}

/**
 * `null` when the URL is acceptable, otherwise the reason it is not.
 *
 * Exported because it is the whole of T-14 and it is a pure function of
 * two strings: `security.test.ts` walks the table of schemes and hosts
 * without building an app.
 */
export function apiBaseUrlRejection(value: string, appEnv: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return 'EXPO_PUBLIC_API_BASE_URL must be a full URL, for example https://api.example.com/api/v1.';
  }

  if (!API_URL_SCHEMES.includes(url.protocol)) {
    return (
      `EXPO_PUBLIC_API_BASE_URL must be an https: URL; got "${url.protocol}". ` +
      'The base URL is concatenated into every request this client makes.'
    );
  }

  if (url.protocol === 'https:') return null;

  if (appEnv !== 'development') {
    return (
      'EXPO_PUBLIC_API_BASE_URL must use https: outside a development build. ' +
      `This build is "${appEnv}" and the URL is cleartext http:, which publishes the ` +
      "patient's access token and their clinical data to every hop on the network (T-14)."
    );
  }

  if (!isLocalHost(url.hostname)) {
    return (
      `EXPO_PUBLIC_API_BASE_URL may only use http: for a host on the developer's own ` +
      `machine or network (localhost, 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, ` +
      `192.168.0.0/16, 169.254.0.0/16). "${url.hostname}" is none of those, so use https:.`
    );
  }

  return null;
}

/** One operator-configured emergency line. See `EXPO_PUBLIC_EMERGENCY_NUMBERS`. */
const emergencyNumberSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{1,32}$/),
    label: z.string().trim().min(1).max(60),
    number: z.string().regex(/^\+?[0-9]{2,15}$/),
    whenToUse: z.string().trim().min(1).max(160).optional(),
    region: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .optional(),
  })
  .strict();

const emergencyNumbersSchema = z
  .array(emergencyNumberSchema)
  .max(6)
  .refine((list) => new Set(list.map((n) => n.id)).size === list.length, 'ids must be unique');

export type ConfiguredEmergencyNumber = z.infer<typeof emergencyNumberSchema>;

const envSchema = z
  .object({
    /**
     * Must include the `/api/v1` prefix (backend ADR-011). Not cosmetic:
     * every route this client will ever call is versioned there.
     *
     * The scheme is checked in a cross-field refinement below rather
     * than here, because whether `http:` is acceptable depends on
     * `EXPO_PUBLIC_APP_ENV` — see `apiBaseUrlRejection`.
     */
    EXPO_PUBLIC_API_BASE_URL: z.string().default('http://localhost:3000/api/v1'),
    EXPO_PUBLIC_APP_ENV: z.enum(['development', 'staging', 'production']).default('development'),
    EXPO_PUBLIC_ENABLE_MOCKS: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
    /**
     * Minutes in the background after which the cached clinical data in
     * memory is swept (checklist T-11, audit R-8). Deliberately short:
     * the cost of a sweep is a refetch.
     */
    EXPO_PUBLIC_PHI_SWEEP_MINUTES: z.coerce.number().int().positive().max(1440).default(5),
    /**
     * Minutes in the background after which the session ends and the
     * patient must sign in again (checklist T-11). Deliberately longer
     * than the sweep: a waiting room is not an abandoned phone, and a
     * gate that fires every five minutes is a gate patients work around.
     */
    EXPO_PUBLIC_REAUTH_MINUTES: z.coerce.number().int().positive().max(1440).default(15),
    /**
     * Where "Update Medora" sends the patient when the forced-upgrade
     * gate trips (checklist W-06). Optional, and deliberately so: there
     * is no published store listing yet (W-01, W-03), and a hardcoded
     * guess would be a button that goes nowhere. Unset, the gate tells
     * the patient to update from their store in words instead — the rule
     * N-04 applies to emergency numbers, for the same reason.
     */
    EXPO_PUBLIC_APP_STORE_URL: z
      .string()
      .url('EXPO_PUBLIC_APP_STORE_URL must be a full URL, or unset')
      .refine(isStoreUrl, {
        message:
          'EXPO_PUBLIC_APP_STORE_URL must be an https:, market: or itms-apps: link. ' +
          '`Linking.openURL` opens whatever scheme it is handed, and this one is the only ' +
          'button on a screen the patient cannot navigate away from.',
      })
      .optional(),
    /**
     * Where "Contact support" writes to (checklist W-11). Optional for
     * the same reason the store link is: there is no support inbox
     * configured yet, and a guessed address is a message that goes
     * nowhere. Unset, the screen says how to reach the clinic in words
     * instead of offering a button that fails silently.
     *
     * An address and not a URL, because `mailto:` opens the patient's
     * own mail app with the message ready to send and nothing in
     * between. It is not a secret: it is the address a clinic prints on
     * its own door.
     */
    EXPO_PUBLIC_SUPPORT_EMAIL: z
      .string()
      .email('EXPO_PUBLIC_SUPPORT_EMAIL must be an email address, or unset')
      .optional(),
    /**
     * Where the terms and the privacy policy are published (E-05).
     *
     * `https:` only — narrower than the store link's allow-list on
     * purpose. A store link opens an app; these open a document a
     * patient is being asked to agree to, and a `market:` or deep-link
     * scheme there would be a consent screen handing control to
     * something that is not a document.
     *
     * Optional, and the screen says so when they are unset rather than
     * offering a button that goes nowhere — the same rule W-11 applies
     * to the support address.
     */
    EXPO_PUBLIC_TERMS_URL: z
      .string()
      .refine(isHttpsUrl, 'EXPO_PUBLIC_TERMS_URL must be an https URL, or unset')
      .optional(),
    EXPO_PUBLIC_PRIVACY_URL: z
      .string()
      .refine(isHttpsUrl, 'EXPO_PUBLIC_PRIVACY_URL must be an https URL, or unset')
      .optional(),
    /**
     * The emergency numbers the Emergency screen offers (checklist N-04).
     *
     * Operator-supplied and OPTIONAL. The app never ships a number of its
     * own: a wrong emergency number is worse than none, and the right one
     * depends on the country the build is released in. Unset (or empty),
     * the screen keeps its honest "not configured" state and tells the
     * patient to call their local emergency number.
     *
     * A JSON array, validated strictly so a typo fails the build's boot
     * rather than dialling the wrong line:
     * `[{"id":"ambulance","label":"Ambulance — الإسعاف","number":"997","region":"SA"}]`
     * `label` and `whenToUse` are rendered verbatim; give them in every
     * language the build serves.
     */
    EXPO_PUBLIC_EMERGENCY_NUMBERS: z
      .string()
      .optional()
      .transform((raw, ctx) => {
        if (raw === undefined || raw.trim() === '') return [];
        let value: unknown;
        try {
          value = JSON.parse(raw);
        } catch {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'EXPO_PUBLIC_EMERGENCY_NUMBERS must be a JSON array, or unset.',
          });
          return z.NEVER;
        }
        const result = emergencyNumbersSchema.safeParse(value);
        if (!result.success) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              'EXPO_PUBLIC_EMERGENCY_NUMBERS is invalid: each entry needs a unique id, a label, ' +
              'and a number of 2–15 digits (an optional leading +); at most 6 entries. ' +
              result.error.issues
                .map((i) => `${i.path.join('.') || '(list)'}: ${i.message}`)
                .join('; '),
          });
          return z.NEVER;
        }
        return result.data;
      }),
  })
  .superRefine((v, ctx) => {
    // T-14. The message is the whole diagnosis — an operator reading a
    // crash log at 3am should not have to open this file to learn which
    // of the three rules they broke.
    const rejection = apiBaseUrlRejection(v.EXPO_PUBLIC_API_BASE_URL, v.EXPO_PUBLIC_APP_ENV);
    if (rejection !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: rejection,
        path: ['EXPO_PUBLIC_API_BASE_URL'],
      });
    }
  })
  .refine((v) => !(v.EXPO_PUBLIC_APP_ENV === 'production' && v.EXPO_PUBLIC_ENABLE_MOCKS), {
    message:
      'EXPO_PUBLIC_ENABLE_MOCKS must be false in production. Fixture data must never reach a patient (checklist V-01).',
    path: ['EXPO_PUBLIC_ENABLE_MOCKS'],
  })
  .refine((v) => v.EXPO_PUBLIC_REAUTH_MINUTES >= v.EXPO_PUBLIC_PHI_SWEEP_MINUTES, {
    message:
      'EXPO_PUBLIC_REAUTH_MINUTES must be at least EXPO_PUBLIC_PHI_SWEEP_MINUTES. Re-authenticating also sweeps the cache, so a shorter re-auth window makes the sweep unreachable.',
    path: ['EXPO_PUBLIC_REAUTH_MINUTES'],
  });

export type Env = {
  readonly apiBaseUrl: string;
  readonly appEnv: 'development' | 'staging' | 'production';
  readonly enableMocks: boolean;
  readonly isDev: boolean;
  /** Milliseconds. See `features/auth/lock-policy.ts`. */
  readonly phiSweepAfterMs: number;
  /** Milliseconds. See `features/auth/lock-policy.ts`. */
  readonly reauthenticateAfterMs: number;
  /** `null` when unconfigured. See `features/app-version/UpgradeGate.tsx`. */
  readonly appStoreUrl: string | null;
  /** `null` when unconfigured. See `features/support/screens/SupportScreen.tsx`. */
  readonly supportEmail: string | null;
  /** Where the terms are published (E-05). `null` when unconfigured. */
  readonly termsUrl: string | null;
  /** Where the privacy policy is published (E-05). */
  readonly privacyUrl: string | null;
  /** Operator-configured emergency lines; empty when unconfigured (N-04). */
  readonly emergencyNumbers: readonly ConfiguredEmergencyNumber[];
};

/** The environment speaks minutes; everything downstream speaks milliseconds. */
const MINUTE_MS = 60_000;

/** Pure, so the production-plus-mocks rejection is testable without a build. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(
      `Invalid environment configuration:\n${JSON.stringify(parsed.error.flatten().fieldErrors, null, 2)}`,
    );
  }
  return {
    apiBaseUrl: parsed.data.EXPO_PUBLIC_API_BASE_URL,
    appEnv: parsed.data.EXPO_PUBLIC_APP_ENV,
    enableMocks: parsed.data.EXPO_PUBLIC_ENABLE_MOCKS,
    isDev: parsed.data.EXPO_PUBLIC_APP_ENV === 'development',
    phiSweepAfterMs: parsed.data.EXPO_PUBLIC_PHI_SWEEP_MINUTES * MINUTE_MS,
    reauthenticateAfterMs: parsed.data.EXPO_PUBLIC_REAUTH_MINUTES * MINUTE_MS,
    // `null` rather than `undefined`: "the operator did not configure a
    // store link" is a value the gate renders a different screen for, not
    // an absent property to be optional-chained past.
    appStoreUrl: parsed.data.EXPO_PUBLIC_APP_STORE_URL ?? null,
    supportEmail: parsed.data.EXPO_PUBLIC_SUPPORT_EMAIL ?? null,
    termsUrl: parsed.data.EXPO_PUBLIC_TERMS_URL ?? null,
    privacyUrl: parsed.data.EXPO_PUBLIC_PRIVACY_URL ?? null,
    emergencyNumbers: parsed.data.EXPO_PUBLIC_EMERGENCY_NUMBERS,
  };
}

// Metro inlines `process.env.EXPO_PUBLIC_*` at build time, so these must
// be read as literal member expressions — a computed lookup over
// `process.env` is not substituted and would be undefined at runtime.
//
// Expo's own type for `process.env` is loose, so each read is narrowed
// to what it actually is — a string or nothing — before Zod sees it.
export const env: Env = parseEnv({
  EXPO_PUBLIC_API_BASE_URL: process.env.EXPO_PUBLIC_API_BASE_URL as string | undefined,
  EXPO_PUBLIC_APP_ENV: process.env.EXPO_PUBLIC_APP_ENV as string | undefined,
  EXPO_PUBLIC_ENABLE_MOCKS: process.env.EXPO_PUBLIC_ENABLE_MOCKS as string | undefined,
  EXPO_PUBLIC_PHI_SWEEP_MINUTES: process.env.EXPO_PUBLIC_PHI_SWEEP_MINUTES as string | undefined,
  EXPO_PUBLIC_REAUTH_MINUTES: process.env.EXPO_PUBLIC_REAUTH_MINUTES as string | undefined,
  EXPO_PUBLIC_APP_STORE_URL: process.env.EXPO_PUBLIC_APP_STORE_URL as string | undefined,
  EXPO_PUBLIC_SUPPORT_EMAIL: process.env.EXPO_PUBLIC_SUPPORT_EMAIL as string | undefined,
  EXPO_PUBLIC_TERMS_URL: process.env.EXPO_PUBLIC_TERMS_URL as string | undefined,
  EXPO_PUBLIC_PRIVACY_URL: process.env.EXPO_PUBLIC_PRIVACY_URL as string | undefined,
  EXPO_PUBLIC_EMERGENCY_NUMBERS: process.env.EXPO_PUBLIC_EMERGENCY_NUMBERS as string | undefined,
});
