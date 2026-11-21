/**
 * PHI- and secret-safe log redaction (RM M1.3, MG §11.6, DB §10).
 *
 * Two layers, because redaction alone is not a sufficient control:
 *
 *  1. **Request and response bodies are never serialised into logs.**
 *     A clinical payload is PHI by definition, and an allow-list of
 *     fields would leak the moment a new field lands. The serialisers in
 *     `logger.config.ts` emit method, route, status and timing only.
 *  2. **These paths are redacted** wherever an object does reach the
 *     logger — an error object carrying `err.config.headers`, a stray
 *     `logger.info({ user })`, a driver error echoing a bound parameter.
 *
 * MG §11.6 is binding: no PHI in URLs, logs, or error messages. The
 * classification below follows DB §10.
 */

/** Credentials and secrets — DB §10 "Credentials/secrets". */
const SECRET_PATHS = [
  'password',
  'newPassword',
  'currentPassword',
  'confirmPassword',
  'passwordHash',
  'password_hash',
  'token',
  'accessToken',
  'refreshToken',
  'otpToken',
  'code',
  'secret',
  'totpSecret',
  'recoveryCodes',
  // Owner decisions R1 and Q7 / R4: a code being redeemed, and the token
  // carrying a not-yet-confirmed second factor.
  'recoveryCode',
  'enrolmentToken',
  'apiKey',
  'key',
  'authorization',
  'cookie',
];

/** Direct patient identifiers — DB §10 "PII". */
const IDENTIFIER_PATHS = [
  'mrn',
  'ssn',
  'nationalId',
  'dateOfBirth',
  'dob',
  'phone',
  'email',
  'address',
  'fullName',
  'firstName',
  'lastName',
  'name',
  'photoUrl',
  'policyNumber',
];

/** Clinical content — DB §10 "PHI (HIPAA-sensitive)". */
const CLINICAL_PATHS = [
  'diagnosis',
  'diagnoses',
  'allergies',
  'allergy',
  'medications',
  'medication',
  'chiefComplaint',
  'historyOfPresentIllness',
  'physicalExamination',
  'treatmentPlan',
  'notes',
  'note',
  'body',
  'interpretation',
  'results',
  'vitals',
  'clinicalIndication',
  'reason',
];

const SENSITIVE_KEYS = [...SECRET_PATHS, ...IDENTIFIER_PATHS, ...CLINICAL_PATHS];

/**
 * pino `redact.paths`. Each key is covered at the log-object root, one
 * level down, and under the common `req`/`err`/`user`/`data` containers.
 * pino matches literal paths and single-level `*` wildcards, so the
 * containers are enumerated rather than globbed.
 */
export const REDACTION_PATHS: readonly string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["set-cookie"]',
  'res.headers["set-cookie"]',
  ...SENSITIVE_KEYS.flatMap((key) => [
    key,
    `*.${key}`,
    `req.body.${key}`,
    `req.query.${key}`,
    `err.${key}`,
    `user.${key}`,
    `data.${key}`,
  ]),
];

export const REDACTION_CENSOR = '[redacted]';

/** Exported for the redaction test — the assertion should name real keys. */
export const REDACTED_KEYS: readonly string[] = SENSITIVE_KEYS;

/**
 * A request URL as it may be logged: the path, never the query string.
 *
 * MG §11.6 forbids PHI in URLs, but a client that puts a patient's name in
 * `?q=` must not turn that into a permanent record in the log store. The
 * access log and the exception filter both log a URL, so the rule lives here
 * once rather than in each — the filter used to log `request.url` whole.
 */
export function loggableUrl(url: string | undefined): string | undefined {
  return url?.split('?')[0];
}
