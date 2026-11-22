/**
 * Runtime environment contract — FRONTEND_ARCHITECTURE.md §2 (configs/).
 * Validated at boot: a misconfigured deployment fails fast with a readable
 * error instead of failing mysteriously at first API call. Only variables
 * prefixed VITE_ are exposed to the client — never secrets.
 *
 * Checked by hand rather than with a zod schema on purpose: this module is
 * on the boot path of every page, so importing zod here put the whole
 * library in the entry chunk that every visit downloads and parses before
 * first paint. Forms still use zod — in their own lazy route chunks. The
 * rules are the same three the schema stated, and `parseEnv` is exported so
 * every one of them is tested (`env.test.ts`).
 *
 * - `VITE_API_BASE_URL` — a string `new URL()` accepts; default
 *   `http://localhost:3000/api/v1`. Must include the API's `/api/v1` prefix
 *   (backend ADR-011). Not cosmetic: the refresh cookie is scoped
 *   `Path=/api/v1/auth`, so a base URL of `/api` means the browser never
 *   attaches it — silent refresh then fails for every user, with no error
 *   anywhere to say why.
 * - `VITE_APP_ENV` — `development` | `staging` | `production`; default
 *   `development`.
 * - `VITE_ENABLE_MOCKS` — `true` | `false`, deliberately with **no
 *   default** — see `resolveEnableMocks`. This field used to default to
 *   `'true'`, which made "the variable is missing" and "the operator asked
 *   for the seeded mock backend" the same state. A production build whose
 *   `VITE_ENABLE_MOCKS` never made it into the deploy environment therefore
 *   served mock auth — anyone could sign in as `doctor@medora.health` — and
 *   looked completely healthy while doing it. Absent must mean off, so
 *   absent is representable.
 *
 * As with the schema, a default applies only when the variable is absent
 * (`undefined`): an empty or wrong value is an error, never a default.
 */
const APP_ENVS = ['development', 'staging', 'production'] as const;
const MOCK_FLAGS = ['true', 'false'] as const;
const DEFAULT_API_BASE_URL = 'http://localhost:3000/api/v1';

export type AppEnv = (typeof APP_ENVS)[number];

export interface ParsedEnv {
  VITE_API_BASE_URL: string;
  VITE_APP_ENV: AppEnv;
  VITE_ENABLE_MOCKS: (typeof MOCK_FLAGS)[number] | undefined;
}

function isUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function isOneOf<T extends string>(options: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (options as readonly string[]).includes(value);
}

/**
 * Validates the raw `import.meta.env` record. Returns the parsed values, or
 * the failing fields with one message each (the shape `flatten().fieldErrors`
 * had, so the boot error reads as it did).
 */
export function parseEnv(
  raw: Record<string, unknown>,
): { success: true; data: ParsedEnv } | { success: false; fieldErrors: Record<string, string[]> } {
  const fieldErrors: Record<string, string[]> = {};

  const apiBaseUrl = raw['VITE_API_BASE_URL'] ?? DEFAULT_API_BASE_URL;
  if (typeof apiBaseUrl !== 'string') fieldErrors['VITE_API_BASE_URL'] = ['Expected string'];
  else if (!isUrl(apiBaseUrl)) fieldErrors['VITE_API_BASE_URL'] = ['Invalid url'];

  const appEnv = raw['VITE_APP_ENV'] ?? 'development';
  if (!isOneOf(APP_ENVS, appEnv)) {
    fieldErrors['VITE_APP_ENV'] = [`Expected ${APP_ENVS.map((v) => `'${v}'`).join(' | ')}`];
  }

  const enableMocks = raw['VITE_ENABLE_MOCKS'];
  if (enableMocks !== undefined && !isOneOf(MOCK_FLAGS, enableMocks)) {
    fieldErrors['VITE_ENABLE_MOCKS'] = [`Expected ${MOCK_FLAGS.map((v) => `'${v}'`).join(' | ')}`];
  }

  if (Object.keys(fieldErrors).length > 0) return { success: false, fieldErrors };
  return {
    success: true,
    data: {
      VITE_API_BASE_URL: apiBaseUrl as string,
      VITE_APP_ENV: appEnv as AppEnv,
      VITE_ENABLE_MOCKS: enableMocks as ParsedEnv['VITE_ENABLE_MOCKS'],
    },
  };
}

/**
 * Resolves the mock-backend flag, and refuses the one combination that is
 * never a deployment anyone wanted: `VITE_APP_ENV=production` together with
 * `VITE_ENABLE_MOCKS=true`.
 *
 * Three rules, in the order they are decided:
 *
 * 1. **Production + mocks requested → throw.** Silently ignoring the flag
 *    would be the more forgiving behaviour and the wrong one: it leaves a
 *    deployment asserting one thing and doing another, and the assertion
 *    is about who is allowed to log in. Fail loudly instead.
 * 2. **Production + anything else → `false`.** Missing, empty, `false`.
 * 3. **Anywhere else → only when explicitly `true`.** Opt-in, never
 *    inherited from an unset variable.
 *
 * Pure and exported, like `selectImplementation` in `api/seam.ts`, so every
 * branch — the throwing one included — is testable without a module
 * registry reset or a rebuilt `import.meta.env`.
 */
export function resolveEnableMocks(appEnv: AppEnv, raw: 'true' | 'false' | undefined): boolean {
  const requested = raw === 'true';

  if (appEnv === 'production' && requested) {
    throw new Error(
      'Invalid environment configuration: VITE_ENABLE_MOCKS=true is not allowed ' +
        'with VITE_APP_ENV=production. The mock backend accepts seeded credentials ' +
        'and never reaches the API, so a production build must not use it. Set ' +
        'VITE_ENABLE_MOCKS=false (or remove it) and point VITE_API_BASE_URL at the ' +
        'real API.',
    );
  }

  return requested;
}

/** Hosts a production build may reach over plain http: only this machine. */
const LOOPBACK_HOSTS: readonly string[] = ['localhost', '127.0.0.1'];

/**
 * Resolves the API base URL, and refuses a production build that would send
 * credentials and PHI over plain http (S2). The schema only checks that the
 * value is a URL, so `VITE_APP_ENV=production` with `http://api.example.com`
 * used to boot and talk to the API in clear text — bearer token, refresh
 * cookie and patient data included.
 *
 * - **Production → `https:` only**, except a loopback host (`localhost`,
 *   `127.0.0.1`): a production bundle served and tested on one machine, and
 *   the schema default, are not a network hop.
 * - **Anywhere else → accepted as given.** Development and staging (the
 *   Vercel demo runs `staging` with mocks on and never calls the API) keep
 *   whatever URL they are pointed at.
 *
 * Pure and exported for the same reason as `resolveEnableMocks`.
 */
export function resolveApiBaseUrl(appEnv: AppEnv, raw: string): string {
  if (appEnv !== 'production') return raw;

  const url = new URL(raw);
  if (url.protocol === 'https:') return raw;
  if (url.protocol === 'http:' && LOOPBACK_HOSTS.includes(url.hostname)) return raw;

  throw new Error(
    'Invalid environment configuration: VITE_API_BASE_URL must use https:// ' +
      'with VITE_APP_ENV=production (got ' +
      url.protocol +
      '//' +
      url.host +
      '). Plain http would send the access token, the refresh cookie and ' +
      'patient data in clear text. Only localhost and 127.0.0.1 are exempt.',
  );
}

const parsed = parseEnv(import.meta.env);

if (!parsed.success) {
  throw new Error(
    `Invalid environment configuration:\n${JSON.stringify(parsed.fieldErrors, null, 2)}`,
  );
}

export const env = {
  apiBaseUrl: resolveApiBaseUrl(parsed.data.VITE_APP_ENV, parsed.data.VITE_API_BASE_URL),
  appEnv: parsed.data.VITE_APP_ENV,
  // A production build compiles the mock backend out (RM M40.4,
  // scripts/mock-boundary.ts): the constant is `true` there, so this is
  // `false` whatever the environment says, and the build itself refuses
  // `VITE_ENABLE_MOCKS=true`. Undefined everywhere else, which changes nothing.
  enableMocks:
    import.meta.env.MEDORA_MOCKS_STRIPPED !== true &&
    resolveEnableMocks(parsed.data.VITE_APP_ENV, parsed.data.VITE_ENABLE_MOCKS),
  isDev: parsed.data.VITE_APP_ENV === 'development',
} as const;
