import { apiClient } from '@/api/client';

/**
 * `GET /auth/session` — WEB-1 (CLIENTS_CHECKLIST, DR-02).
 *
 * Read for one field only: the doctor's active hospital, for display in the
 * shell. The session itself (user, role, permissions) still comes from
 * `POST /auth/refresh` and the sign-in routes in `auth.ts`; nothing here
 * changes `SessionUser` or the auth lifecycle.
 *
 * `activeHospital` is non-null only for a doctor with exactly one active
 * employment. `null` is ambiguous (no employment, more than one, suspended,
 * a failed lookup) and the API gives no reason, so the client renders
 * nothing rather than guessing. It is display information, not an
 * authorization boundary (backend Phase 22 shadow mode).
 *
 * `adminScope` is deliberately not read: how Platform Admin and Hospital
 * Admin are told apart is pending an owner decision (GitHub issue #16).
 */

export interface ActiveHospital {
  readonly id: string;
  readonly name: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * The active hospital from a `{ data: … }` body, or `null`. Strict: anything
 * but an object with a non-empty string `id` and `name` is treated as no
 * hospital, so a malformed answer can never render a made-up name.
 */
export function readActiveHospital(body: unknown): ActiveHospital | null {
  if (!isRecord(body) || !isRecord(body['data'])) return null;
  const hospital = body['data']['activeHospital'];
  if (!isRecord(hospital)) return null;
  const { id, name } = hospital;
  if (!nonEmptyString(id) || !nonEmptyString(name)) return null;
  return { id, name };
}

export async function fetchActiveHospital(signal?: AbortSignal): Promise<ActiveHospital | null> {
  const body = await apiClient.get<unknown>(
    '/auth/session',
    undefined,
    signal === undefined ? {} : { signal },
  );
  return readActiveHospital(body);
}
