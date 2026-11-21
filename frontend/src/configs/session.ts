/**
 * Session policy defaults — FRONTEND_ARCHITECTURE.md §6.4 / UX 1.5.
 * The idle-lock threshold is admin-configurable server-side; these are
 * the client defaults used until the session payload overrides them.
 */
export const sessionPolicy = {
  /** Idle time before the session locks (blur overlay + re-auth). */
  idleLockMs: 10 * 60 * 1000,
  /** Warning shown this long before the lock engages. */
  idleWarningMs: 60 * 1000,
} as const;
