/**
 * Storage ports.
 *
 * The audit's four-tier policy (§12.4) is the reason there are two of
 * these and not one, and the reason neither is called "storage":
 *
 * | Tier            | Content                                   | Port              |
 * |-----------------|-------------------------------------------|-------------------|
 * | Bundled         | Emergency guidance, disclaimers, first aid | (the app bundle)  |
 * | Secure          | Refresh token — nothing else              | `SecureStore`     |
 * | Non-sensitive   | Theme, locale, onboarding flags, non-PHI  | `PreferenceStore` |
 * | Memory only     | Access token, and ALL PHI                 | (never a store)   |
 *
 * The access token and every byte of PHI live in memory: the TanStack
 * Query cache and the session object, cleared on logout, on session loss
 * and on background timeout. A record cached on a lost, unlocked phone is
 * a disclosure (audit R-8), so there is deliberately no port that could
 * accept one — `PreferenceStore` takes strings and is documented as
 * non-PHI, and `phi-guard.test.ts` is the test that proves nothing
 * PHI-shaped reaches it.
 *
 * That last sentence named a file that **did not exist** until
 * 2026-09-08. The policy above was real, the design followed it, and the
 * proof was a claim in a comment — which is the same defect
 * `docs/A11Y_AUDIT.md` records as F-5, in a different file. The guard is
 * structural rather than behavioural: it asserts no clinical feature
 * *imports* anything that outlives the process, which covers the code
 * path nobody has written yet as well as the ones that exist.
 */

/** Platform keychain / keystore. The refresh token, and nothing else. */
export interface SecureStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/**
 * Durable, non-sensitive key/value. Theme choice, locale, "onboarding
 * seen". Never PHI, never a token.
 *
 * Synchronous by design: the theme has to resolve before the first paint
 * or the app flashes the wrong palette on every cold start.
 */
export interface PreferenceStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  /** Everything this store holds — used by the logout sweep's assertion. */
  keys(): readonly string[];
}
