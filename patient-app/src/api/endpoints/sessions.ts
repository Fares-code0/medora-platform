import { z } from 'zod';

import { envelopeSchema, parseResponse } from '@/schemas/envelope';

import { apiClient } from '../client';

/**
 * The HTTP adapter for the caller's own sessions — checklist P-06.
 *
 * ── Two routes, and both exist ───────────────────────────────────────
 *
 * Transcribed from
 * `backend/src/modules/auth/controllers/account-security.controller.ts`:
 *
 *   GET    /me/sessions              :59   API §2.4
 *   DELETE /me/sessions/{sessionId}  :80   API §2.5, 204
 *
 * They landed with **M8** (the users-and-account milestone). Until then
 * `http-profile-service.ts` refused both by name with `BE-10 / M8`, which
 * was the correct answer while the module did not exist and is the wrong
 * one now that it does.
 *
 * Both are `@Authenticated()` at class level with **no `userId`
 * parameter** — the subject is the token. That is the whole
 * authorization rule, and it is why a patient may call them at all: a
 * patient holds zero capabilities (ADR-030 §6), so a `@Can(...)` here
 * would have denied the audience the routes exist for.
 *
 * ── This file reads four fields of eight, on purpose ─────────────────
 *
 * `ActiveSessionView` carries `location` and `ipAddress` as well. They
 * are **not** read here and the port has nowhere to put them.
 *
 * An IP address and a coarse geolocation are personal data that this
 * screen does not need: the question a patient answers on it is *do I
 * recognise this device*, and a device name and a last-used time answer
 * it. Parsing the other two would put them in a query cache, in a
 * component tree and one `logger` call away from a crash report, to
 * render nothing. The schema is an allow-list for the same reason
 * `endpoints/profile.ts` is one — a field that is never parsed cannot
 * leak.
 *
 * `startedAt` is dropped for the duller reason that the screen shows
 * "last used" and not "signed in on", and a second timestamp nothing
 * renders is a field that goes stale in the type rather than on screen.
 *
 * ── `device` and `browser` are both nullable ─────────────────────────
 *
 * They are columns on `sessions`, populated from a user agent, and
 * either can be null — so the pair cannot be relied on to yield a name.
 * The mapping to a displayable label is **not** done here: a client that
 * substituted an English "Unknown device" in its transport layer would
 * be writing untranslated copy into a screen, which is the C-09 defect
 * this tree has now found four times. The adapter reports the absence
 * and the screen says so in the patient's language.
 */

/**
 * API §2.4. `current` is computed server-side against the session the
 * calling access token was minted from — this client cannot know it and
 * does not try.
 */
const activeSessionSchema = z.object({
  id: z.string().min(1),
  device: z.string().nullable(),
  browser: z.string().nullable(),
  lastActiveAt: z.string().min(1),
  current: z.boolean(),
});

const sessionsResponseSchema = envelopeSchema(z.array(activeSessionSchema));

export type WireActiveSession = z.infer<typeof activeSessionSchema>;

export const sessionEndpoints = {
  /** 200 `{ data: ActiveSession[] }`. The caller's own, never another's. */
  async list() {
    const raw = await apiClient.get<unknown>('me/sessions');
    return parseResponse('GET /me/sessions', sessionsResponseSchema, raw);
  },

  /**
   * 204. A session that is not the caller's answers **404**, not 403 —
   * the server does not confirm that an id it refuses exists.
   *
   * There is no response to parse, so there is no schema: inventing one
   * would be inventing a contract (`endpoints/account.ts` makes the same
   * call about `POST /me/password`).
   */
  async revoke(sessionId: string): Promise<void> {
    await apiClient.delete<unknown>(`me/sessions/${encodeURIComponent(sessionId)}`);
  },
};
