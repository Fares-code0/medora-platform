/**
 * GCM additional-data contexts for envelopes bound to their row (ADR-045).
 *
 * Here rather than in the owning module because two readers must agree on
 * it byte for byte: the module that seals and opens the value, and
 * `EnvelopeReencryptionService`, which re-seals it under a new key and
 * lives in `shared/` — which may not import from `modules/`.
 */

/**
 * `sessions.successor_token_ct`: the refresh-token successor, bound to its
 * purpose and to `sessions.id`. Ciphertext copied onto another row, or
 * into another column that happens to use `EnvelopeService`, fails GCM
 * authentication instead of being believed there. `v1` versions the
 * context itself, so a future change of binding cannot be confused with
 * this one.
 */
export function sessionRefreshSuccessorAad(sessionId: string): string {
  return `medora:session-refresh-successor:v1:${sessionId}`;
}
