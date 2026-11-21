/**
 * Feature flags — FRONTEND_ARCHITECTURE.md §13.2.
 * Partially complete features land behind flags. Flags are build-time
 * constants for now; swap to a remote provider without changing consumers.
 *
 * ## `aiAssistant` was removed, not wired (D-08 / F-12)
 *
 * F-12 called it dead code. It was not, and that was the actual defect: it
 * had exactly ONE reader, `AppNavbar`, where it hid the navbar's Sparkles
 * shortcut. Everything else about `features/doctor/ai/` — 20 files, a chat
 * surface, patient binding, conversation CRUD, streaming render — mounted
 * regardless, because the routes are unconditional and the sidebar and
 * bottom tab bar gate on the `ai.use` **permission**.
 *
 * So one module had three entry points answering to two different rules:
 * the sidebar showed the assistant, the URL opened it, and the navbar
 * button alone claimed it did not exist. A flag is a switch for work that
 * is *incomplete*, and this module is not — turning it on would only have
 * restored a shortcut to a page already one click away in the sidebar,
 * while leaving `false` committed kept asserting that a built, reachable
 * feature was off.
 *
 * The false statement was the flag, so the flag went and the navbar now
 * gates on `ai.use`, the same permission its two siblings read. Whether a
 * deployment should be able to disable the assistant is a real question,
 * but it is a question about permissions — `ai.use` already answers it per
 * role — and about the model service D-09 waits on, not a build constant.
 *
 * ## `billing` gates nothing YET, and that is not the same defect
 *
 * `false` is an accurate statement here: no billing widget exists to switch
 * on (ADM-01's Revenue tile is explicitly not built). It stays as the
 * declaration those widgets will read. **It has no consumer, so flipping it
 * to `true` today does nothing** — whoever builds the widgets must call
 * `isFeatureEnabled('billing')` from them rather than assume this file is
 * already load-bearing.
 */
export const featureFlags = {
  /** Per-doctor billing widgets (UX 2.1 / 3.1 revenue cards). Unbuilt. */
  billing: false,
} as const;

export type FeatureFlag = keyof typeof featureFlags;

export function isFeatureEnabled(flag: FeatureFlag): boolean {
  return featureFlags[flag];
}
