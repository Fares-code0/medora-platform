/**
 * Correlation and idempotency identifiers.
 *
 * Hermes does not ship `crypto.randomUUID`, and RN has no `crypto` global
 * on every platform/engine combination, so this falls back to a v4-shaped
 * string built from `Math.random`.
 *
 * That fallback is fine for what these ids are FOR — correlating a client
 * request with a server log line, and de-duplicating a retried POST. It is
 * **not** cryptographic randomness and nothing security-bearing may use
 * it. When a token, a nonce or a key is needed, `expo-crypto` is the
 * dependency to add; there is no such need in this tree today.
 */
export function randomId(): string {
  const cryptoObj = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof cryptoObj?.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const rand = (Math.random() * 16) | 0;
    const value = char === 'x' ? rand : (rand & 0x3) | 0x8;
    return value.toString(16);
  });
}
